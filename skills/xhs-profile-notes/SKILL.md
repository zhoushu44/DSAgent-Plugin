---
name: xhs-profile-notes
description: "只读采集指定小红书作者公开主页的笔记列表，按点赞数排序，查找最高赞作品。触发：小红书作者主页、博主最高赞、主页作品采集。"
metadata:
  dsagent:
    display_name: "小红书·作者主页作品"
    requires:
      xhs: "小红书账号"
---

# 小红书作者主页作品

通过 DSAgent 代理和登录态读取公开笔记，不读取私密信息，不发布、不修改平台内容。

> `python {this_skill_dir}/scripts/fetch_profile.py --user-id <ID> --xsec-token <token> --pages 3`

## 前置条件

- 已绑定有效的 xhs 账号。
- 从公开分享链接取得作者 ID 和 xsec_token；不传 token 时尝试空值。
- 控制翻页数量，页间至少等待 3 秒。

## 错误处理

- 遇到风控立即停止，不连续重试；返回原始错误码。
- 空响应或结构变化按失败处理，不当作无作品。
