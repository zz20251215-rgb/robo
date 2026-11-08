"""Command line entry points for the Python reference model."""

from __future__ import annotations

import argparse
import json
import sys
from math import degrees, radians
from pathlib import Path

from .mechanism import AnkleMechanism, Load, Params

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "legacy-reference.json"


def _fmt(value: float, digits: int = 3) -> str:
    return f"{value:.{digits}f}"


def verify(fixture: Path) -> int:
    """Compare this implementation against the shared legacy fixture."""
    data = json.loads(fixture.read_text(encoding="utf-8"))
    mech = AnkleMechanism()
    failures: list[str] = []
    checks = 0

    for pose in data["poses"]:
        pitch = radians(pose["pitchDeg"])
        roll = radians(pose["rollDeg"])
        ik = mech.solve_ik(pitch, roll)
        checks += 1
        if ik.ok != pose["ikOk"]:
            failures.append(f"pitch {pose['pitchDeg']:+.1f} roll {pose['rollDeg']:+.1f}: ik.ok {ik.ok} != {pose['ikOk']}")
            continue
        if not ik.ok:
            continue

        checks += 1
        for name, actual, expected in (
            ("theta1", degrees(ik.theta1), pose["theta1Deg"]),
            ("theta2", degrees(ik.theta2), pose["theta2Deg"]),
        ):
            if abs(actual - expected) > 1e-8:
                failures.append(f"pitch {pose['pitchDeg']:+.1f}: {name} {actual:.12f} != {expected:.12f}")

        statics = mech.statics(pitch, roll, ik.theta1, ik.theta2, Load())
        if statics.kind != "ok":
            if not pose["singular"]:
                failures.append(f"pitch {pose['pitchDeg']:+.1f}: unexpected singularity {statics.kind}")
            continue

        checks += 1
        for name, actual, expected, tol in (
            ("tau_m1", statics.tau_m1, pose["tauM1"], 1e-6),
            ("tau_m2", statics.tau_m2, pose["tauM2"], 1e-6),
            ("f_rod1", statics.f_rod1, pose["fRod1"], 1e-4),
            ("f_rod2", statics.f_rod2, pose["fRod2"], 1e-4),
            ("mu1", statics.mu1_deg, pose["mu1Deg"], 1e-4),
            ("mu2", statics.mu2_deg, pose["mu2Deg"], 1e-4),
            ("cond", statics.cond, pose["cond"], 1e-6),
        ):
            if abs(actual - expected) > tol:
                failures.append(f"pitch {pose['pitchDeg']:+.1f}: {name} {actual:.9f} != {expected:.9f} (tol {tol})")

    for row in data["fk"]:
        pitch, roll = radians(row["pitchDeg"]), radians(row["rollDeg"])
        ik = mech.solve_ik(pitch, roll)
        if not ik.ok:
            continue
        fk = mech.solve_fk(ik.theta1, ik.theta2, (pitch, roll))
        checks += 2
        if not fk.ok:
            failures.append(f"fk at {row['pitchDeg']:+.1f}/{row['rollDeg']:+.1f}: did not converge")
            continue
        if abs(degrees(fk.pitch) - row["fkPitchDeg"]) > 1e-6:
            failures.append(f"fk pitch {degrees(fk.pitch):.9f} != {row['fkPitchDeg']:.9f}")
        if abs(degrees(fk.roll) - row["fkRollDeg"]) > 1e-6:
            failures.append(f"fk roll {degrees(fk.roll):.9f} != {row['fkRollDeg']:.9f}")

    print(f"fixture: {fixture}")
    print(f"checks:  {checks}")
    if failures:
        print(f"FAILED ({len(failures)})")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("OK: python reference matches the shared fixture")
    return 0


def pose(args: argparse.Namespace) -> int:
    mech = AnkleMechanism()
    pitch, roll = radians(args.pitch), radians(args.roll)
    ik = mech.solve_ik(pitch, roll)
    if not ik.ok:
        print(f"无解: pitch {args.pitch}°, roll {args.roll}°")
        return 1
    statics = mech.statics(pitch, roll, ik.theta1, ik.theta2)
    print(f"θ₁ / θ₂   {degrees(ik.theta1):+.2f}° / {degrees(ik.theta2):+.2f}°")
    if statics.kind != "ok":
        print(f"奇异: {statics.kind}, μ {_fmt(statics.mu1_deg, 1)}° / {_fmt(statics.mu2_deg, 1)}°")
        return 0
    print(f"τ₁ / τ₂   {statics.tau_m1:+.2f} / {statics.tau_m2:+.2f} Nm")
    print(f"μ₁ / μ₂   {statics.mu1_deg:.1f}° / {statics.mu2_deg:.1f}°")
    print(f"κ         {statics.cond:.3f}")
    print(f"杆力      {statics.f_rod1:.0f} / {statics.f_rod2:.0f} N")
    return 0


def reach(args: argparse.Namespace) -> int:
    mech = AnkleMechanism()
    span = mech.reachable_pitch(args.roll)
    if span is None:
        print(f"roll {args.roll}° 无可行俯仰区间")
        return 1
    print(f"roll {args.roll}°: pitch {span[0]:+.1f}° … {span[1]:+.1f}°")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ankle-ref", description="2-RSS+1-U ankle reference model")
    sub = parser.add_subparsers(dest="command", required=True)

    verify_cmd = sub.add_parser("verify", help="compare against tests/fixtures/legacy-reference.json")
    verify_cmd.add_argument("fixture", nargs="?", type=Path, default=DEFAULT_FIXTURE)
    verify_cmd.set_defaults(handler=verify)

    pose_cmd = sub.add_parser("pose", help="print a single pose report")
    pose_cmd.add_argument("--pitch", type=float, default=0.0)
    pose_cmd.add_argument("--roll", type=float, default=0.0)
    pose_cmd.set_defaults(handler=pose)

    reach_cmd = sub.add_parser("reach", help="print the reachable pitch interval")
    reach_cmd.add_argument("--roll", type=float, default=0.0)
    reach_cmd.set_defaults(handler=reach)

    args = parser.parse_args(argv)
    if args.command == "verify":
        return verify(args.fixture)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
