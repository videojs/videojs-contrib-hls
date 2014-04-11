# Video.JS HLS Live

## Brightcove Service Differences: 
- Brightcove uses the Zencoder HLS Live API.
- Once ingest begins, approximately 50 seconds later the original manifest is available. 
- I have not seen any ability to enforce a sliding window, so I believe Brightcove Live HLS serves all available segments on a continuously growing manifest. 
- One minute after last disconnect from the ingest stream, the event is considered complete and the final manifest delivered. 
- The final manifest will be different in two distinct ways, it will include the `EXT-X-ENDLIST` tag notifying all connected clients that the live stream has concluded and is now VOD. It will also contain a custom ZEN-TOTAL-DURATION:<i> tag with <i> representing the total amount of recorded time in seconds.

## Akamai Service Differences:
- Akamai only serves HLS Live off of Akamai HD2 endpoints.
- These vary from their HDS counterparts by url syntax.
	- <host> /i/ vs. <host> /z/ for HDS
	- `master.m3u8` vs.`manifest.frm` for HDS
- Their endpoints are difficult to arrange CORS configurations on.
- Akamai manifests span the gamut of known HLS tags, both supported and unsupported by our plugin.

## Once Service Differences:
- Once manifests tend to include the use of `EXT-X-DISCONTINUITY` tags which are unsupported to date. 
- Once streams so far tend to use a different encoding algorithm on their segments which sometime result in a range error during transmuxing.

