# SJTU Library Downloader for Google Scholar

一个 Chrome MV3 插件：在 `scholar.google.com` 每条文献标题旁新增“馆藏下载”按钮，自动执行 Scholar -> Primo -> 在线全文 -> EBSCO -> PDF 下载。

## 功能

- 在 Scholar 搜索结果每条论文旁注入“馆藏下载”按钮
- 自动提取论文标题并跳转 SJTU Primo 检索
- 按标题相似度选最匹配结果并点击“在线全文”
- 在 SFX 页面点击 EBSCOhost 入口
- 在 EBSCO 页面尝试提取 PDF 链接并调用浏览器下载
- 自动文件名：`论文标题(清洗后截断80字符).pdf`
- 自动失败时降级：保留在目标页面并提示手动下载

## 安装

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本目录：`SJTULibDownloader`

## 使用

1. 打开 `https://scholar.google.com/` 并搜索论文
2. 在结果标题右侧点击“馆藏下载”
3. 插件会自动打开新标签执行跳转
4. 如需设置下载路径，打开扩展详情页后点“扩展程序选项”，在配置页修改“下载路径”
4. 结果按钮状态说明：
   - `进行中...`：自动流程执行中
   - `已下载`：已创建浏览器下载任务
   - `请手动下载`：已到最终页面，请手动点 PDF
   - `失败重试`：流程中断，可再次点击重试

默认下载路径说明：
- Chrome 最终下载目录由浏览器设置决定，Windows 常见为 `C:\Users\Allan\Downloads\`
- 插件配置默认值已预置为 `C:\Users\Allan\Downloads\`
- 若填写绝对路径，Chrome API 会回退到默认下载目录根（浏览器限制）
- 若想分类保存，请填相对路径（例如 `papers/sjtu`），文件会落到 `下载目录/papers/sjtu/`

## 测试

运行纯逻辑/配置测试：

```bash
node tests/run-tests.mjs
```

测试覆盖：
- Scholar 标题前缀清洗
- 标题相似度评分基础行为
- 文件名合法化与长度限制
- Primo URL 编码
- `manifest.json` 基本结构合法
- 下载路径解析（绝对路径回退、相对路径生效）

批量打开 `tests/test-cite.bib` 的 Scholar 检索页（用于你手动点插件按钮测试）：

```bash
node tests/open-scholar-from-bib.mjs --interactive
```

可选：
- `--no-interactive --delay 1`：每隔 1 秒自动打开下一篇
- `--dry-run`：只打印 URL，不打开浏览器

## 已知限制

- 仅注入 `scholar.google.com`，不包含其他 `scholar.*` 域名
- SFX 页面当前按 `*.exlibrisgroup.com.cn` 匹配，如果学校后续切换到其他域名，需要补 host 权限
- EBSCO 站点常有动态脚本和权限校验，可能无法拿到直链，此时会自动降级为手动下载
- 需要你已经具备馆藏访问权限（登录/VPN/校园网）
