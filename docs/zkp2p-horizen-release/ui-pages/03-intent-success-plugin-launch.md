# 03 Intent Success + Plugin Launch

## Page goal
Intent 创建后，引导用户启动插件并前往 Wise 采集。

## Must show
- 成功横幅：`Intent 已创建，额度已预占用`
- Intent 卡片：`intentId` / 锁定金额 / `buyerAddress` / 创建时间
- 5 步 stepper：
  1. Intent 已创建
  2. 启动 Proof 插件
  3. 前往 Wise 页面采集证明数据
  4. 提交 zkVerify
  5. 链上放款
- 主按钮：`启动 Proof 插件`
- 次按钮：`打开 Wise 页面`
- 安全提示：browser proving only / 请勿关闭当前页

## Data bindings
- intent 数据来自创建接口返回。
- balance 侧栏使用最新 `availableBalance` 与 `reservedBalance`。

## UX checks
- 若插件未注入，显示“先安装并加载插件”。
