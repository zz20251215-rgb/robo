#!/usr/bin/env python3
"""
Generate publication-quality rational analytical figures for 2-RSS+1-U ankle joint.
Saves figure to ankle_rational_curves.png.
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from verify_mechanism import AnkleMechanism2RSS1U

def generate_curves():
    ankle = AnkleMechanism2RSS1U()
    
    pitch_deg = np.linspace(-30.0, 25.0, 200)
    roll_deg = 0.0 # Neutral roll
    
    th1_list, th2_list = [], []
    tau1_list, tau2_list = [], []
    mu1_list, mu2_list = [], []
    cond_list = []
    
    # 500 N single stance load, CoP at ball of foot (x = +0.08m, y = 0.0m)
    F_grf = np.array([0.0, 0.0, 500.0])
    r_cop = np.array([0.08, 0.0, -0.06])
    
    for p in pitch_deg:
        p_rad = np.radians(p)
        r_rad = np.radians(roll_deg)
        
        (th1, th2), ok = ankle.inverse_kinematics(p_rad, r_rad)
        if not ok:
            th1_list.append(np.nan)
            th2_list.append(np.nan)
            tau1_list.append(np.nan)
            tau2_list.append(np.nan)
            mu1_list.append(np.nan)
            mu2_list.append(np.nan)
            cond_list.append(np.nan)
            continue
            
        th1_list.append(np.degrees(th1))
        th2_list.append(np.degrees(th2))
        
        jac = ankle.jacobian(p_rad, r_rad, th1, th2)
        if jac is None:
            tau1_list.append(np.nan)
            tau2_list.append(np.nan)
            mu1_list.append(np.nan)
            mu2_list.append(np.nan)
            cond_list.append(np.nan)
            continue
            
        mu1_list.append(jac['mu1_deg'])
        mu2_list.append(jac['mu2_deg'])
        cond_list.append(jac['cond'])
        
        stat = ankle.statics_force_to_torque(p_rad, r_rad, F_grf, r_cop)
        if stat is None:
            tau1_list.append(np.nan)
            tau2_list.append(np.nan)
        else:
            tau1_list.append(stat['tau_motor'][0])
            tau2_list.append(stat['tau_motor'][1])
            
    # Plotting 2x2 grid
    fig, axes = plt.subplots(2, 2, figsize=(11, 8), dpi=200)
    plt.subplots_adjust(hspace=0.28, wspace=0.24)
    
    # 1. Kinematics Mapping
    ax1 = axes[0, 0]
    ax1.plot(pitch_deg, th1_list, label=r'Motor 1 $\theta_1$', color='#0284c7', lw=2)
    ax1.plot(pitch_deg, th2_list, label=r'Motor 2 $\theta_2$', color='#d97706', lw=2, ls='--')
    ax1.set_title('(a) Kinematic Mapping (Motor Angles vs Pitch)', fontsize=11, fontweight='bold')
    ax1.set_xlabel('Foot Pitch Angle [deg]')
    ax1.set_ylabel('Motor Shaft Angle [deg]')
    ax1.grid(True, ls=':', alpha=0.6)
    ax1.legend(frameon=True)
    
    # 2. Statics Torque Mapping
    ax2 = axes[0, 1]
    ax2.plot(pitch_deg, tau1_list, label=r'Motor 1 $\tau_1$', color='#0284c7', lw=2)
    ax2.plot(pitch_deg, tau2_list, label=r'Motor 2 $\tau_2$', color='#d97706', lw=2, ls='--')
    ax2.set_title('(b) Statics Load Response ($F_z=500N$, $CoP_x=80mm$)', fontsize=11, fontweight='bold')
    ax2.set_xlabel('Foot Pitch Angle [deg]')
    ax2.set_ylabel('Required Motor Torque [Nm]')
    ax2.grid(True, ls=':', alpha=0.6)
    ax2.legend(frameon=True)
    
    # 3. Transmission Angle
    ax3 = axes[1, 0]
    ax3.axhspan(45, 135, color='#dcfce7', alpha=0.6, label='Safe Zone (45°-135°)')
    ax3.plot(pitch_deg, mu1_list, label=r'Transmission Angle $\mu_1$', color='#0284c7', lw=2)
    ax3.plot(pitch_deg, mu2_list, label=r'Transmission Angle $\mu_2$', color='#d97706', lw=2, ls='--')
    ax3.set_title('(c) Transmission Angle Quality', fontsize=11, fontweight='bold')
    ax3.set_xlabel('Foot Pitch Angle [deg]')
    ax3.set_ylabel('Transmission Angle [deg]')
    ax3.set_ylim(30, 150)
    ax3.grid(True, ls=':', alpha=0.6)
    ax3.legend(frameon=True)
    
    # 4. Condition Number / Dexterity
    ax4 = axes[1, 1]
    ax4.plot(pitch_deg, cond_list, label=r'Condition Number $\kappa(J_\theta)$', color='#9333ea', lw=2)
    ax4.set_title('(d) Jacobian Condition Number & Dexterity', fontsize=11, fontweight='bold')
    ax4.set_xlabel('Foot Pitch Angle [deg]')
    ax4.set_ylabel('Condition Number $\kappa$')
    ax4.grid(True, ls=':', alpha=0.6)
    ax4.legend(frameon=True)
    
    plt.suptitle('2-RSS+1-U Parallel Robotic Ankle Rational Analysis', fontsize=13, fontweight='bold', y=0.98)
    save_path = '/Users/zz/ankle_2rss_1u/ankle_rational_curves.png'
    plt.savefig(save_path, bbox_inches='tight')
    print(f"Figure successfully saved to: {save_path}")

if __name__ == '__main__':
    generate_curves()
