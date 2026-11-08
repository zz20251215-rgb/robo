# ANKLE · 2-RSS + 1-U 踝关节工作台

面向双侧 RSS 曲柄连杆 + 中央 U 铰踝关节的运动学、静力学与传力特性交互工作台。核心计算与渲染完全模块化，浏览器端零框架依赖，页面可离线运行。

## 特性

- **单一数值内核**：闭式逆解（半角代换）、阻尼牛顿正解、任务/驱动雅可比、虚功静力映射，全部集中在 `src/core`，渲染层与 UI 层只消费结果。
- **规范化类型**：逆解、正解、静力均为判别联合，奇异位形与不收敛状态显式返回，不再出现字段缺失的“半成品”结果。
- **分层渲染**：纯 Canvas 的 3D 球棍视图、俯仰/横滚工作空间热力图、四张分析曲线，各自独立且共享同一状态快照。
- **可核对数值**：内置旧版基准夹具，TypeScript 与 Python 两套实现分别对同一组位姿做回归校验。
- **离线可用**：无 CDN、无外部字体、无 UI 框架；`npm run build` 产物即为完整静态站点。

## 快速开始

前端（Node 20+）：

```bash
npm install
npm run dev      # 本地开发服务器
npm run build    # 类型检查 + 生产构建，输出 dist/
npm run verify   # 类型检查 + 全部单元测试
```

Python 参考模型（uv 管理，Python 3.11+）：

```bash
uv sync                 # 创建 .venv 并安装 ankle-ref
uv run ankle-ref verify # 对共享夹具做 46 项数值校验
uv run ankle-ref pose --pitch 10 --roll 0
uv run ankle-ref reach --roll 0
```

## 目录结构

```
src/
  core/        math, mechanism, curves, assessment      # 纯数值，可在 Node 中直接测试
  state/       store, model                            # 单一可变状态与派生数据
  render/      scene, pad, chart                       # Canvas 渲染，只读状态
  ui/          controls, readouts, gait, export        # DOM 绑定与文案
  styles/      main.css                                # 设计令牌与布局
  main.ts                                              # 组装与渲染调度
python/
  src/ankle_ref/  mechanism.py, cli.py                  # NumPy 参考实现与校验命令
scripts/
  gen-reference.mjs                                     # 从旧版页面抽取基准夹具
tests/
  core.test.ts, fixtures/legacy-reference.json
```

## 坐标与默认参数

基座两点 `A₁/A₂ = [x_base, ±w_base/2, h_base]`，足端两点 `C₁/C₂ = [x_foot, ±w_foot/2, z_foot]` 经 `R = Ry(pitch)·Rx(roll)` 变换。曲柄平面由 `u=[0,1,0]`、`v=[0,0,-1]`、`w=u×v=[-1,0,0]` 张成，`θ=0` 时曲柄竖直向下，中立位 `θ≈+31.2°`，正角为背屈。

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `w_base` | 70 mm | 基座电机半间距 |
| `h_base` | 180 mm | 电机轴高度 |
| `x_base` | −40 mm | 电机轴前后偏置 |
| `l_crank` | 45 mm | 曲柄长度 |
| `l_rod` | 165 mm | 连杆长度 |
| `w_foot` | 60 mm | 足端铰点半间距 |
| `x_foot` | −30 mm | 足端铰点前后位置 |
| `z_foot` | −20 mm | 足端铰点高度 |

默认载荷 `Fz=500 N`、`Fx=Fy=0`、`CoP=[80, 0, −60] mm`。死点判据 `|h| < 2 mm`，架构奇异 `|det J_task| < 1e-5`，驱动奇异 `|det J_θ| < 1e-6`。

## 交互

- 3D 视图：拖拽旋转、滚轮缩放；顶部切换等轴/侧/正/俯视，右侧开关坐标系与电机轴。
- 位姿卡：拖拽热力盘直接设定俯仰与横滚；热力图按几何与载荷缓存，绿色为健康、琥珀为预警、玫红为奇异、暗红为无解。
- 驱动模式：逆解驱动（位姿 → 电机角）与电机驱动（电机角 → 位姿）。正解报告残差与收敛状态，不收敛时给出提示而不是静默给出错误位姿。
- 电机角显示：绝对角 / 相对角（相对中立位）。
- 载荷卡：调节 `Fz/Fx` 与压力中心，四张曲线随载荷即时重算。
- 顶部按钮：步态演示（30 ms 帧率，支撑相正弦加载与 CoP 平移）、导出 JSON（`ankle-workbench/v2`）、复位姿态。

## 验证

- `npm run verify`：13 个单元测试，覆盖中立角、10 个位姿的逆解与静力、逆解→正解往返、56 点曲线扫掠，误差阈值与旧实现逐项对齐。
- `uv run ankle-ref verify`：Python 实现独立复算同一夹具的 46 项数值，用于捕捉移植偏差。
- 夹具来源：`scripts/gen-reference.mjs` 从 `.cache/legacy-index.html` 抽取旧版 `AnkleModel` 生成；旧版页面与构建产物均不参与运行时。

## 说明

- 传力角曲线使用精确 `|h|/|v_crank|`，与旧版 `+1e-9` 分母的差异约 `1e-6°`，测试按 5 位小数比对。
- 工作空间热力图在 `roll = ±10°` 以上迅速退化为预警/无解，这是 45 mm 曲柄与 165 mm 连杆在此几何下的真实边界，不是渲染误差。
- 曲线横轴固定为 `pitch ∈ [−30, 25]°`，无解处断线，奇异处条件数按 100 处理。
