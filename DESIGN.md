# 蓝色黏土风界面

本项目采用浅色蓝系 Claymorphism：雾蓝背景、奶白表面、深蓝主按钮，使用内外阴影与圆角表达柔软的立体层次。它是整站视觉样式，班级名称、人数、时间、教室、定位及请假规则继续使用后台保存的配置。

## 样式入口

- `app/globals.css`：基础结构、业务组件布局与响应式规则。
- `app/clay.css`：蓝色黏土风的颜色、材质、字号、状态和响应式覆盖；在根布局中后导入。
- `components/study-scene.tsx`：登录页的 CSS 书本、台灯和月亮装饰，标记为装饰内容，不需要图片、外部字体或额外运行依赖。
- `components/policy-settings.module.css`：业务规则配置表单，使用整站主题变量。

## 核心变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `--clay-canvas` | `#edf2f8` | 页面背景 |
| `--clay-surface` | `#f8fbff` | 卡片表面 |
| `--clay-primary` | `#35659f` | 主要操作、图表 |
| `--clay-primary-deep` | `#244d80` | 强调状态 |
| `--clay-ink` | `#243b56` | 正文和标题 |
| `--clay-muted` | `#566d87` | 次级说明 |
| `--clay-raised` | 内外多层阴影 | 主要卡片 |
| `--clay-inset` | 双向内阴影 | 输入框与选中状态 |

浅蓝是整体品牌色。审批通过、待审批、失败仍同时通过文字与语义颜色区分，不依赖颜色传达结果。图表按真实数量显示，零值不绘制完成进度或柱形占位。

## 手机与键盘使用

- 手机端调整为单列或双列，表格只在自己的容器内横向滚动。
- 表单输入保留可见标签；手机输入文字为 16px，主要触控入口至少 44px。
- 手机菜单提供展开状态、Escape 关闭和键盘焦点约束；关闭后返回原触发位置。
- 选择按钮提供 `aria-pressed`，当前导航提供 `aria-current`。
- 为系统的减少动态效果偏好保留静态反馈，不使用自动播放或持续漂浮动画。
- 主要文字与按钮采用高对比的深蓝配色，阴影用于材质，不作为唯一的选中或错误提示。

## 参考

设计参考 [design-taste-frontend](https://github.com/Leonxlnx/taste-skill/tree/main/skills/taste-skill) 的产品识别、真实数据和界面复核建议，以及 [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 的 Claymorphism、触控和可读性建议。

本次按用户明确选择采用蓝色黏土风，因此保留该风格需要的圆角和立体阴影。使用项目已有 Next.js、CSS 和 Lucide 图标；界面通过实际浏览器检查，不依赖这些技能附带的独立浏览器脚本。
