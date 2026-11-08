"""Numerical reference model for the 2-RSS + 1-U ankle mechanism.

This module mirrors the TypeScript core in ``src/core/mechanism.ts`` using plain
NumPy so the two implementations can be cross-checked. It is deliberately
independent of the browser code: same equations, different language, shared
fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import acos, atan, cos, degrees, radians, sin, sqrt

import numpy as np

Vec3 = np.ndarray

#: Lever arms shorter than this are treated as a dead-centre singularity.
DEAD_CENTRE_LEVER = 0.002
#: Task Jacobian determinants below this are treated as architectural singularities.
ARCHITECTURAL_DET = 1e-5
#: Actuator Jacobian determinants below this are rejected numerically.
SINGULAR_DET = 1e-6


@dataclass(frozen=True)
class Params:
    """Mechanism geometry in metres."""

    w_base: float = 0.070
    h_base: float = 0.180
    x_base: float = -0.040
    l_crank: float = 0.045
    l_rod: float = 0.165
    w_foot: float = 0.060
    x_foot: float = -0.030
    z_foot: float = -0.020


@dataclass(frozen=True)
class Load:
    """Ground reaction force and centre of pressure in metres/newtons."""

    fz: float = 500.0
    fx: float = 0.0
    fy: float = 0.0
    x_cop: float = 0.080
    y_cop: float = 0.0
    z_sole: float = -0.060


@dataclass(frozen=True)
class IKResult:
    ok: bool
    theta1: float
    theta2: float
    disc1: float
    disc2: float


@dataclass(frozen=True)
class FKResult:
    ok: bool
    pitch: float
    roll: float
    residual: float


@dataclass(frozen=True)
class Statics:
    kind: str
    tau_m1: float
    tau_m2: float
    f_rod1: float
    f_rod2: float
    mu1_deg: float
    mu2_deg: float
    cond: float
    lever1: float
    lever2: float
    det_j: float


def rotation_matrix(pitch: float, roll: float) -> np.ndarray:
    """Platform rotation ``Ry(pitch) · Rx(roll)``."""
    ca, sa = cos(pitch), sin(pitch)
    cb, sb = cos(roll), sin(roll)
    return np.array(
        [
            [ca, sa * sb, sa * cb],
            [0.0, cb, -sb],
            [-sa, ca * sb, ca * cb],
        ]
    )


def _solve_chain(c: Vec3, a: Vec3, v: Vec3, w: Vec3, l_crank: float, l_rod: float) -> tuple[bool, float, float]:
    d = c - a
    e = -2.0 * l_crank * float(d @ v)
    f = -2.0 * l_crank * float(d @ w)
    g = float(d @ d) + l_crank * l_crank - l_rod * l_rod
    disc = 4.0 * f * f - 4.0 * (g - e) * (g + e)
    if disc < 0.0:
        return False, 0.0, disc

    root = sqrt(disc)
    qa = g - e
    qb = 2.0 * f
    qc = g + e
    if abs(qa) > 1e-9:
        t1 = (-qb + root) / (2.0 * qa)
        t2 = (-qb - root) / (2.0 * qa)
    elif abs(qb) > 1e-9:
        t1 = t2 = -qc / qb
    else:
        return False, 0.0, disc

    theta1 = 2.0 * atan(t1)
    theta2 = 2.0 * atan(t2)
    return True, theta1 if abs(theta1) <= abs(theta2) else theta2, disc


class AnkleMechanism:
    """Two RSS chains driving a foot platform through a central U joint."""

    def __init__(self, params: Params | None = None) -> None:
        self.params = params or Params()
        p = self.params
        self.a1 = np.array([p.x_base, p.w_base / 2.0, p.h_base])
        self.a2 = np.array([p.x_base, -p.w_base / 2.0, p.h_base])
        self.u = np.array([0.0, 1.0, 0.0])
        self.v = np.array([0.0, 0.0, -1.0])
        self.w = np.cross(self.u, self.v)
        self.c1_p = np.array([p.x_foot, p.w_foot / 2.0, p.z_foot])
        self.c2_p = np.array([p.x_foot, -p.w_foot / 2.0, p.z_foot])

    def platform_points(self, pitch: float, roll: float) -> tuple[Vec3, Vec3]:
        r = rotation_matrix(pitch, roll)
        return r @ self.c1_p, r @ self.c2_p

    def crank_tips(self, theta1: float, theta2: float) -> tuple[Vec3, Vec3]:
        lc = self.params.l_crank
        b1 = self.a1 + lc * (cos(theta1) * self.v + sin(theta1) * self.w)
        b2 = self.a2 + lc * (cos(theta2) * self.v + sin(theta2) * self.w)
        return b1, b2

    def solve_ik(self, pitch: float, roll: float) -> IKResult:
        c1, c2 = self.platform_points(pitch, roll)
        p = self.params
        ok1, theta1, disc1 = _solve_chain(c1, self.a1, self.v, self.w, p.l_crank, p.l_rod)
        ok2, theta2, disc2 = _solve_chain(c2, self.a2, self.v, self.w, p.l_crank, p.l_rod)
        return IKResult(ok1 and ok2, theta1, theta2, disc1, disc2)

    def solve_fk(self, theta1: float, theta2: float, guess: tuple[float, float] = (0.0, 0.0)) -> FKResult:
        b1, b2 = self.crank_tips(theta1, theta2)
        l_rod_sq = self.params.l_rod**2
        pitch, roll = guess
        residual = float("inf")
        for _ in range(24):
            c1, c2 = self.platform_points(pitch, roll)
            f1 = float((c1 - b1) @ (c1 - b1)) - l_rod_sq
            f2 = float((c2 - b2) @ (c2 - b2)) - l_rod_sq
            residual = max(abs(f1), abs(f2))
            if residual < 1e-10:
                return FKResult(True, pitch, roll, residual)

            eps = 1e-6
            p_plus, p_minus = self.platform_points(pitch + eps, roll), self.platform_points(pitch - eps, roll)
            r_plus, r_minus = self.platform_points(pitch, roll + eps), self.platform_points(pitch, roll - eps)
            dp1 = (float((p_plus[0] - b1) @ (p_plus[0] - b1)) - float((p_minus[0] - b1) @ (p_minus[0] - b1))) / (2 * eps)
            dp2 = (float((p_plus[1] - b2) @ (p_plus[1] - b2)) - float((p_minus[1] - b2) @ (p_minus[1] - b2))) / (2 * eps)
            dr1 = (float((r_plus[0] - b1) @ (r_plus[0] - b1)) - float((r_minus[0] - b1) @ (r_minus[0] - b1))) / (2 * eps)
            dr2 = (float((r_plus[1] - b2) @ (r_plus[1] - b2)) - float((r_minus[1] - b2) @ (r_minus[1] - b2))) / (2 * eps)
            det = dp1 * dr2 - dr1 * dp2
            if abs(det) < 1e-12:
                break
            d_pitch = (dr2 * f1 - dr1 * f2) / det
            d_roll = (-dp2 * f1 + dp1 * f2) / det
            pitch = min(1.2, max(-1.2, pitch - min(0.35, max(-0.35, d_pitch))))
            roll = min(1.2, max(-1.2, roll - min(0.35, max(-0.35, d_roll))))
        return FKResult(residual < 1e-8, pitch, roll, residual)

    def statics(
        self,
        pitch: float,
        roll: float,
        theta1: float,
        theta2: float,
        load: Load | None = None,
    ) -> Statics:
        load = load or Load()
        p = self.params
        c1, c2 = self.platform_points(pitch, roll)
        b1, b2 = self.crank_tips(theta1, theta2)

        rod1, rod2 = c1 - b1, c2 - b2
        n1 = rod1 / np.linalg.norm(rod1)
        n2 = rod2 / np.linalg.norm(rod2)

        ca, sa = cos(pitch), sin(pitch)
        col_pitch = np.array([0.0, 1.0, 0.0])
        col_roll = np.array([ca, 0.0, -sa])

        arm1, arm2 = np.cross(c1, n1), np.cross(c2, n2)
        j_task = np.array(
            [
                [float(arm1 @ col_pitch), float(arm1 @ col_roll)],
                [float(arm2 @ col_pitch), float(arm2 @ col_roll)],
            ]
        )

        crank_dir1 = np.cross(self.u, b1 - self.a1)
        crank_dir2 = np.cross(self.u, b2 - self.a2)
        lever1 = float(n1 @ crank_dir1)
        lever2 = float(n2 @ crank_dir2)
        mu1 = degrees(acos(min(1.0, abs(lever1) / max(float(np.linalg.norm(crank_dir1)), 1e-12))))
        mu2 = degrees(acos(min(1.0, abs(lever2) / max(float(np.linalg.norm(crank_dir2)), 1e-12))))
        det_task = float(np.linalg.det(j_task))

        if abs(lever1) < DEAD_CENTRE_LEVER or abs(lever2) < DEAD_CENTRE_LEVER:
            return Statics("dead-centre", float("nan"), float("nan"), float("nan"), float("nan"), mu1, mu2, 999.0, lever1, lever2, 0.0)

        j_theta = np.array([[j_task[0, 0] / lever1, j_task[0, 1] / lever1], [j_task[1, 0] / lever2, j_task[1, 1] / lever2]])
        det_j = float(np.linalg.det(j_theta))
        if abs(det_task) < ARCHITECTURAL_DET or abs(det_j) < SINGULAR_DET:
            return Statics("architecture", float("nan"), float("nan"), float("nan"), float("nan"), mu1, mu2, 999.0, lever1, lever2, det_j)

        sigma = np.linalg.svd(j_theta, compute_uv=False)
        cond = 999.0 if sigma[1] < 1e-6 else float(sigma[0] / sigma[1])

        force = np.array([load.fx, load.fy, load.fz])
        r_cop = np.array([load.x_cop, load.y_cop, load.z_sole])
        moment = np.cross(r_cop, force)
        tau_pitch = float(moment @ col_pitch)
        tau_roll = float(moment @ col_roll)

        j_inv_t = np.linalg.inv(j_theta).T
        tau_m1 = float(j_inv_t[0, 0] * tau_pitch + j_inv_t[0, 1] * tau_roll)
        tau_m2 = float(j_inv_t[1, 0] * tau_pitch + j_inv_t[1, 1] * tau_roll)
        return Statics(
            "ok",
            tau_m1,
            tau_m2,
            tau_m1 / lever1,
            tau_m2 / lever2,
            mu1,
            mu2,
            cond,
            lever1,
            lever2,
            det_j,
        )

    def neutral_angles(self) -> tuple[float, float]:
        ik = self.solve_ik(0.0, 0.0)
        return (ik.theta1, ik.theta2) if ik.ok else (0.0, 0.0)

    def reachable_pitch(self, roll: float, lo: float = -30.0, hi: float = 25.0, step: float = 0.5) -> tuple[float, float] | None:
        hits = [p for p in np.arange(lo, hi + 1e-9, step) if self.solve_ik(radians(p), radians(roll)).ok]
        return (float(min(hits)), float(max(hits))) if hits else None
