`clip.mp4` is synthetic: 3 s of ffmpeg's `testsrc2` pattern at 160x120 and 25 fps with a `sine` tone, metadata
stripped. The end-to-end test in `src/pipeline.rs` decodes it. Made with:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x120:rate=25:duration=3 -f lavfi -i sine=duration=3 -c:v libx264 \
  -pix_fmt yuv420p -crf 30 -c:a aac -b:a 32k -shortest -map_metadata -1 clip.mp4
```
