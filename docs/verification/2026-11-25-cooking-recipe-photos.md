# LO-COOK-001 做饭首发候选与照片许可

本候选包含「记一餐」、只读的「今天吃啥」和四张有据可核的菜谱成品照片。站内私人照片显示、上传和保存仍是独立事项，首发不含本地预览控件。设计验收待确认。

| 菜谱 | 成品原图 | 权利依据 |
| --- | --- | --- |
| 小龙虾 | [固定提交中的成品.jpg](https://github.com/Anduin2017/HowToCook/blob/a0b14bd388ee996943173679c3a7c9db7da04a6c/dishes/aquatic/%E5%B0%8F%E9%BE%99%E8%99%BE/%E6%88%90%E5%93%81.jpg) | [HowToCook Unlicense](https://github.com/Anduin2017/HowToCook/blob/a0b14bd388ee996943173679c3a7c9db7da04a6c/LICENSE) |
| 油焖大虾 | [固定提交中的油焖大虾.jpg](https://github.com/Anduin2017/HowToCook/blob/a0b14bd388ee996943173679c3a7c9db7da04a6c/dishes/aquatic/%E6%B2%B9%E7%84%96%E5%A4%A7%E8%99%BE/%E6%B2%B9%E7%84%96%E5%A4%A7%E8%99%BE.jpg) | 同一固定仓库许可证 |
| 清蒸鲈鱼 | [固定提交中的清蒸鲈鱼.jpg](https://github.com/Anduin2017/HowToCook/blob/a0b14bd388ee996943173679c3a7c9db7da04a6c/dishes/aquatic/%E6%B8%85%E8%92%B8%E9%B2%88%E9%B1%BC/%E6%B8%85%E8%92%B8%E9%B2%88%E9%B1%BC.jpg) | 同一固定仓库许可证 |
| 西红柿炒鸡蛋 | [Tomato and eggs.JPG，由 Godofnanjing 摄影](https://commons.wikimedia.org/w/index.php?title=File:Tomato_and_eggs.JPG&oldid=1186740600) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |

前三张是固定 HowToCook 菜谱中指向库内文件的成品图。使用原归档中的 LFS 指针核验原图字节数和 SHA-256。番茄炒蛋采用 Commons 上标为作者本人作品的独立成品照。其 WebP 版本继续以 CC BY-SA 3.0 提供。界面详情显示署名、原图来源、许可证和缩放转码说明。全部原图与生成资源的 SHA-256 及尺寸保存在[照片清单](../../src/cooking/recipe-photos.json)，HowToCook [许可证副本](../../third-party/howtocook/LICENSE)随仓库保留。

照片纠正 EXIF 方向后缩放为两种尺寸，转为 WebP 并去除 EXIF/XMP。缩略图 4,312–6,902 字节，详情图 27,772–52,540 字节。图片随 Next 静态产物同源分发，首屏展开菜谱前没有图片请求。缺少可核照片的菜谱显示文字占位。

验证入口为 `/personal/cooking`。隔离 Chromium 合成验证覆盖 390px、430px 共享壳，成品照和缺图占位，选菜零写入，以及「记一餐」保存回读和同键恢复。正式发布前由本人验收桌面及手机的视觉与操作。
