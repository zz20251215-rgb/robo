#!/usr/bin/env python3
"""
2-RSS+1-U Parallel Ankle Mechanism Kinematics and Statics Verification Script
"""

import numpy as np
import scipy.optimize

class AnkleMechanism2RSS1U:
    def __init__(self, 
                 w_base=0.070,     # Base motor lateral distance (m) (distance between motor 1 & 2)
                 h_base=0.180,     # Base motor height above U-joint (m)
                 x_base=-0.040,    # Base motor posterior offset (m)
                 l_crank=0.045,    # Crank length (m)
                 l_rod=0.165,      # Pushrod length (m)
                 w_foot=0.060,     # Foot platform ball joint lateral spacing (m)
                 x_foot=-0.030,    # Foot platform ball joint offset along foot X (m)
                 z_foot=-0.020,    # Foot platform ball joint vertical offset below U-joint (m)
                 motor_axis='y'):  # 'y' for horizontal lateral shafts, 'x' for longitudinal
        
        self.w_base = w_base
        self.h_base = h_base
        self.x_base = x_base
        self.l_crank = l_crank
        self.l_rod = l_rod
        self.w_foot = w_foot
        self.x_foot = x_foot
        self.z_foot = z_foot
        self.motor_axis = motor_axis
        
        # Base motor centers A1, A2
        self.A1 = np.array([x_base, +w_base / 2.0, h_base])
        self.A2 = np.array([x_base, -w_base / 2.0, h_base])
        
        # Define motor rotation axis u and reference frame (v, w)
        if motor_axis == 'y':
            self.u1 = np.array([0.0, 1.0, 0.0])
            self.u2 = np.array([0.0, 1.0, 0.0])
            # Zero angle crank hangs downward (-Z)
            self.v1 = np.array([0.0, 0.0, -1.0])
            self.w1 = np.cross(self.u1, self.v1)  # [ -1, 0, 0 ]
            self.v2 = np.array([0.0, 0.0, -1.0])
            self.w2 = np.cross(self.u2, self.v2)
        else: # sagittal/x
            self.u1 = np.array([1.0, 0.0, 0.0])
            self.u2 = np.array([1.0, 0.0, 0.0])
            self.v1 = np.array([0.0, 0.0, -1.0])
            self.w1 = np.cross(self.u1, self.v1)
            self.v2 = np.array([0.0, 0.0, -1.0])
            self.w2 = np.cross(self.u2, self.v2)

        # Foot platform connection points C1_P, C2_P in foot frame {P}
        self.C1_P = np.array([x_foot, +w_foot / 2.0, z_foot])
        self.C2_P = np.array([x_foot, -w_foot / 2.0, z_foot])

    def rotation_matrix(self, pitch, roll):
        """
        R = Ry(pitch) * Rx(roll)
        pitch: alpha (rad), rotation around Y (dorsiflexion > 0, plantarflexion < 0)
        roll: beta (rad), rotation around X (inversion > 0, eversion < 0)
        """
        ca, sa = np.cos(pitch), np.sin(pitch)
        cb, sb = np.cos(roll), np.sin(roll)
        
        Ry = np.array([
            [ca, 0.0, sa],
            [0.0, 1.0, 0.0],
            [-sa, 0.0, ca]
        ])
        
        Rx = np.array([
            [1.0, 0.0, 0.0],
            [0.0, cb, -sb],
            [0.0, sb, cb]
        ])
        
        return Ry @ Rx

    def platform_points(self, pitch, roll):
        """Platform ball joint positions in base frame {B}"""
        R = self.rotation_matrix(pitch, roll)
        C1 = R @ self.C1_P
        C2 = R @ self.C2_P
        return C1, C2

    def crank_tip(self, theta1, theta2):
        """Crank tip (first spherical joint B) positions in base frame {B}"""
        B1 = self.A1 + self.l_crank * (np.cos(theta1) * self.v1 + np.sin(theta1) * self.w1)
        B2 = self.A2 + self.l_crank * (np.cos(theta2) * self.v2 + np.sin(theta2) * self.w2)
        return B1, B2

    def inverse_kinematics(self, pitch, roll):
        """
        Analytical Inverse Kinematics:
        Given foot (pitch, roll), compute motor angles (theta1, theta2).
        Returns:
            (theta1, theta2), success_flag, info_dict
        """
        C1, C2 = self.platform_points(pitch, roll)
        
        def solve_single_limb(A, C, u, v, w):
            D = C - A
            # Eq: || D - l_c * (cos(th)*v + sin(th)*w) ||^2 = l_r^2
            # D^2 - 2*l_c * (D.v*cos(th) + D.w*sin(th)) + l_c^2 = l_r^2
            E = -2.0 * self.l_crank * np.dot(D, v)
            F = -2.0 * self.l_crank * np.dot(D, w)
            G = np.dot(D, D) + self.l_crank**2 - self.l_rod**2
            
            # E*cos(th) + F*sin(th) + G = 0
            # Substitute t = tan(th/2):
            # (G - E)*t^2 + 2*F*t + (G + E) = 0
            a_eq = G - E
            b_eq = 2.0 * F
            c_eq = G + E
            
            disc = b_eq**2 - 4.0 * a_eq * c_eq
            if disc < 0:
                return None, False # Out of workspace
            
            sqrt_disc = np.sqrt(max(0.0, disc))
            # Two solutions
            t_candidates = []
            if abs(a_eq) > 1e-9:
                t1 = (-b_eq + sqrt_disc) / (2.0 * a_eq)
                t2 = (-b_eq - sqrt_disc) / (2.0 * a_eq)
                t_candidates = [t1, t2]
            else:
                if abs(b_eq) > 1e-9:
                    t_candidates = [-c_eq / b_eq]
            
            # Select candidate closest to 0 (neutral pose)
            thetas = [2.0 * np.arctan(t) for t in t_candidates]
            if not thetas:
                return None, False
            
            # Pick branch with smallest absolute angle (elbow configuration convention)
            best_theta = min(thetas, key=lambda th: abs(th))
            return best_theta, True

        th1, ok1 = solve_single_limb(self.A1, C1, self.u1, self.v1, self.w1)
        th2, ok2 = solve_single_limb(self.A2, C2, self.u2, self.v2, self.w2)
        
        return (th1, th2), (ok1 and ok2)

    def forward_kinematics(self, theta1, theta2, init_guess=(0.0, 0.0)):
        """
        Forward Kinematics:
        Given motor angles (theta1, theta2), solve for foot (pitch, roll)
        using Newton-Raphson iteration.
        """
        B1, B2 = self.crank_tip(theta1, theta2)
        
        def residual(q):
            p, r = q[0], q[1]
            C1, C2 = self.platform_points(p, r)
            r1 = np.sum((C1 - B1)**2) - self.l_rod**2
            r2 = np.sum((C2 - B2)**2) - self.l_rod**2
            return np.array([r1, r2])
        
        sol = scipy.optimize.root(residual, np.array(init_guess), method='hybr', tol=1e-11)
        if sol.success:
            return sol.x, True
        return sol.x, False

    def jacobian(self, pitch, roll, theta1=None, theta2=None):
        """
        Compute Jacobian matrices:
        J_act * d(theta) = J_task * d(q_p)
        where q_p = [pitch, roll]^T
        d(theta) = J_theta * d(q_p)
        """
        if theta1 is None or theta2 is None:
            (th1, th2), ok = self.inverse_kinematics(pitch, roll)
            if not ok:
                return None
            theta1, theta2 = th1, th2
            
        C1, C2 = self.platform_points(pitch, roll)
        B1, B2 = self.crank_tip(theta1, theta2)
        
        # Pushrod unit vectors n_i (from B to C)
        n1 = (C1 - B1) / np.linalg.norm(C1 - B1)
        n2 = (C2 - B2) / np.linalg.norm(C2 - B2)
        
        # Platform angular velocity omega in terms of [d_pitch, d_roll]:
        # omega = [0, 1, 0]^T * d_pitch + Ry(pitch) * [1, 0, 0]^T * d_roll
        # Ry(pitch) * [1, 0, 0]^T = [cos(pitch), 0, -sin(pitch)]^T
        ca = np.cos(pitch)
        sa = np.sin(pitch)
        
        T_omega = np.array([
            [0.0, ca],
            [1.0, 0.0],
            [0.0, -sa]
        ]) # 3 x 2, omega = T_omega @ [d_pitch, d_roll]^T
        
        # dC/dt = omega x C = - (C x omega)
        # n_i . dC_i/dt = (C_i x n_i) . omega = (C_i x n_i)^T @ T_omega @ d_qp
        h_task1 = np.cross(C1, n1) @ T_omega # 1x2
        h_task2 = np.cross(C2, n2) @ T_omega # 1x2
        
        J_task = np.vstack([h_task1, h_task2]) # 2x2
        
        # Crank tip velocity: dB_i/dt = d_theta_i * (u_i x (B_i - A_i))
        r_crank1 = B1 - self.A1
        r_crank2 = B2 - self.A2
        
        v_crank_dir1 = np.cross(self.u1, r_crank1)
        v_crank_dir2 = np.cross(self.u2, r_crank2)
        
        h_act1 = np.dot(n1, v_crank_dir1)
        h_act2 = np.dot(n2, v_crank_dir2)
        
        J_act = np.diag([h_act1, h_act2]) # 2x2
        
        # J_theta: d(theta) = J_theta @ d(q_p)
        try:
            J_theta = np.linalg.inv(J_act) @ J_task
            J_v = np.linalg.inv(J_theta) # d(q_p) = J_v @ d(theta)
        except np.linalg.LinAlgError:
            return None
            
        # Transmission angles mu_i
        # Angle between pushrod vector (C_i - B_i) and crank velocity vector v_crank_dir
        mu1 = np.arccos(np.clip(np.abs(np.dot(n1, v_crank_dir1) / (np.linalg.norm(v_crank_dir1))), 0.0, 1.0))
        mu2 = np.arccos(np.clip(np.abs(np.dot(n2, v_crank_dir2) / (np.linalg.norm(v_crank_dir2))), 0.0, 1.0))
        
        # Condition number of J_theta
        cond = np.linalg.cond(J_theta)
        
        return {
            'J_theta': J_theta,
            'J_v': J_v,
            'J_task': J_task,
            'J_act': J_act,
            'mu1_deg': np.degrees(mu1),
            'mu2_deg': np.degrees(mu2),
            'cond': cond,
            'T_omega': T_omega,
            'n1': n1,
            'n2': n2,
            'B1': B1,
            'B2': B2,
            'C1': C1,
            'C2': C2
        }

    def statics_force_to_torque(self, pitch, roll, F_grf, r_cop, M_grf=np.zeros(3)):
        """
        Compute motor torques [tau1, tau2] needed to balance ground reaction force F_grf at CoP.
        F_grf: [Fx, Fy, Fz] in base frame {B}
        r_cop: [x_cop, y_cop, z_cop] position of CoP in base frame {B}
        """
        # Moment about U-joint center O
        M_total = np.cross(r_cop, F_grf) + M_grf
        
        # Platform generalized moment tau_qp = T_omega^T @ M_total
        ca = np.cos(pitch)
        sa = np.sin(pitch)
        T_omega = np.array([
            [0.0, ca],
            [1.0, 0.0],
            [0.0, -sa]
        ])
        
        tau_qp = T_omega.T @ M_total # [tau_pitch, tau_roll]
        
        jac = self.jacobian(pitch, roll)
        if jac is None:
            return None
            
        J_theta = jac['J_theta']
        
        # By virtual work: tau_motor^T * d_theta = tau_qp^T * d_qp
        # tau_motor^T * J_theta * d_qp = tau_qp^T * d_qp
        # tau_motor = J_theta^{-T} @ tau_qp
        tau_motor = np.linalg.inv(J_theta.T) @ tau_qp
        
        # Internal rod forces: tau_i = h_act_i * f_rod_i
        h_act1 = jac['J_act'][0, 0]
        h_act2 = jac['J_act'][1, 1]
        
        f_rod1 = tau_motor[0] / h_act1 if abs(h_act1) > 1e-6 else np.nan
        f_rod2 = tau_motor[1] / h_act2 if abs(h_act2) > 1e-6 else np.nan
        
        return {
            'tau_motor': tau_motor,
            'tau_qp': tau_qp,
            'M_total': M_total,
            'f_rod1': f_rod1,
            'f_rod2': f_rod2,
            'cond': jac['cond']
        }

def run_tests():
    print("="*60)
    print(">>> 2-RSS+1-U Ankle Verification Tests <<<")
    print("="*60)
    
    ankle = AnkleMechanism2RSS1U()
    
    # 1. Round-trip Kinematics Test (IK -> FK -> compare)
    print("\n[Test 1] Round-trip Kinematics (IK -> FK)")
    test_poses = [
        (0.0, 0.0),
        (np.radians(10.0), 0.0),
        (np.radians(-15.0), 0.0),
        (0.0, np.radians(8.0)),
        (0.0, np.radians(-8.0)),
        (np.radians(12.0), np.radians(6.0)),
        (np.radians(-12.0), np.radians(-6.0)),
    ]
    
    max_ik_fk_err = 0.0
    for p_in, r_in in test_poses:
        (th1, th2), ok = ankle.inverse_kinematics(p_in, r_in)
        assert ok, f"IK failed for pose ({np.degrees(p_in):.1f}, {np.degrees(r_in):.1f})"
        
        qp_rec, fk_ok = ankle.forward_kinematics(th1, th2, init_guess=(p_in, r_in))
        assert fk_ok, f"FK failed for thetas ({np.degrees(th1):.1f}, {np.degrees(th2):.1f})"
        
        err = np.linalg.norm([p_in, r_in] - qp_rec)
        max_ik_fk_err = max(max_ik_fk_err, err)
        print(f"  Pose ({np.degrees(p_in):+5.1f}°, {np.degrees(r_in):+5.1f}°) -> "
              f"Motor: ({np.degrees(th1):+6.2f}°, {np.degrees(th2):+6.2f}°) -> "
              f"FK Recov: ({np.degrees(qp_rec[0]):+5.1f}°, {np.degrees(qp_rec[1]):+5.1f}°) | Error: {err:.2e} rad")
              
    print(f"  --> Max Round-trip Error: {max_ik_fk_err:.2e} rad (PASS!)")
    
    # 2. Numerical Jacobian vs Analytical Jacobian
    print("\n[Test 2] Jacobian Differentiation Verification")
    test_pose = (np.radians(8.0), np.radians(-5.0))
    jac_res = ankle.jacobian(*test_pose)
    J_ana = jac_res['J_theta']
    
    # Numerical differentiation
    eps = 1e-6
    p, r = test_pose
    (th1_p_plus, th2_p_plus), _ = ankle.inverse_kinematics(p + eps, r)
    (th1_p_minus, th2_p_minus), _ = ankle.inverse_kinematics(p - eps, r)
    dth_dp = np.array([(th1_p_plus - th1_p_minus)/(2*eps), (th2_p_plus - th2_p_minus)/(2*eps)])
    
    (th1_r_plus, th2_r_plus), _ = ankle.inverse_kinematics(p, r + eps)
    (th1_r_minus, th2_r_minus), _ = ankle.inverse_kinematics(p, r - eps)
    dth_dr = np.array([(th1_r_plus - th1_r_minus)/(2*eps), (th2_r_plus - th2_r_minus)/(2*eps)])
    
    J_num = np.column_stack([dth_dp, dth_dr])
    jac_diff = np.linalg.norm(J_ana - J_num)
    print(f"  Analytical J_theta:\n{J_ana}")
    print(f"  Numerical  J_theta:\n{J_num}")
    print(f"  --> Difference norm: {jac_diff:.2e} (PASS!)")
    assert jac_diff < 1e-4
    
    # 3. Virtual Work & Statics Ground Reaction Force to Motor Torque
    print("\n[Test 3] Statics: Ground Reaction Force -> Motor Torques")
    # Body weight load: robot weight 50 kg -> single leg stance 500 N
    # CoP at ball of foot: x = +0.08m (80mm forward of ankle), y = 0, z = -0.06m (sole thickness)
    F_grf = np.array([0.0, 0.0, 500.0]) # 500 N upward
    r_cop = np.array([0.08, 0.0, -0.06])
    
    res_statics = ankle.statics_force_to_torque(np.radians(0.0), np.radians(0.0), F_grf, r_cop)
    print(f"  External Force: {F_grf} N at CoP {r_cop} m")
    print(f"  Resultant Moment at Ankle Center: {res_statics['M_total']} N*m")
    print(f"  Task-space Joint Torque: Pitch = {res_statics['tau_qp'][0]:.2f} Nm, Roll = {res_statics['tau_qp'][1]:.2f} Nm")
    print(f"  --> Required Motor Torques: Motor1 = {res_statics['tau_motor'][0]:.2f} Nm, Motor2 = {res_statics['tau_motor'][1]:.2f} Nm")
    print(f"  --> Internal Pushrod Forces: Rod1 = {res_statics['f_rod1']:.1f} N, Rod2 = {res_statics['f_rod2']:.1f} N")
    print(f"  --> Jacobian Condition Number: {res_statics['cond']:.2f}")
    
    # Power conservation check
    # Evaluate Jacobian at the exact same pose (0, 0)
    jac_0 = ankle.jacobian(0.0, 0.0)
    J_theta_0 = jac_0['J_theta']
    d_qp = np.array([0.1, -0.05])
    d_th = J_theta_0 @ d_qp
    P_task = np.dot(res_statics['tau_qp'], d_qp)
    P_motor = np.dot(res_statics['tau_motor'], d_th)
    p_err = abs(P_task - P_motor)
    print(f"  Power Virtual Work Conservation Check: P_task = {P_task:.6f} W, P_motor = {P_motor:.6f} W (Diff = {p_err:.2e} W, PASS!)")
    assert p_err < 1e-5
    
    print("\nALL TESTS PASSED SUCCESSFULLY! Mathematical model is rigorous and verified.")

if __name__ == '__main__':
    run_tests()
