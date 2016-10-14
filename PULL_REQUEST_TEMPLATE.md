## Description
At first,please accept my apologies for my poor English.Thank you for your patience.
As we know When the segement is Encrypted,we will get the key for every segment.But the key is the same for the same video as usually.So the request is a waste.
I store the key in code and check if it is exist for every XMLHttpRequest.

## Specific Changes proposed
- Add a key.js to store the key we get.
- Check if the key is exist for every segement.So the segement-loader.js is changed.

## Requirements Checklist
- [ ] Feature implemented / Bug fixed
- [ ] If necessary, more likely in a feature request than a bug fix
  - [ ] Unit Tests updated or fixed
  - [ ] Docs/guides updated
  - [ ] Example created ([Example Link](http://default.prod.dev.qiqiuyun.cn:9071/video-player/examples/demo-sdk-play-rate-display.html))
- [ ] Reviewed by Two Core Contributors
