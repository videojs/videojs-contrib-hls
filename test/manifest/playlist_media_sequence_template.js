window.playlist_media_sequence_template = '#EXTM3U\n'+
'#EXT-X-PLAYLIST-TYPE:VOD\n'+
'{{#if mediaSequence}}#EXT-X-MEDIA-SEQUENCE:{{{mediaSequence}}}{{/if}}\n'+
'{{#if mediaSequence2}}#EXT-X-MEDIA-SEQUENCE:{{{mediaSequence2}}}{{/if}}\n'+
'#EXT-X-ALLOW-CACHE:YES\n'+
'#EXT-X-TARGETDURATION:8\n'+
'#EXTINF:6.640,{}\n'+
'/test/ts-files/tvy7/8a5e2822668b5370f4eb1438b2564fb7ab12ffe1-hi720.ts\n'+
'#EXTINF:6.080,{}\n'+
'/test/ts-files/tvy7/56be1cef869a1c0cc8e38864ad1add17d187f051-hi720.ts\n'+
'#EXTINF:6.600,{}\n'+
'/test/ts-files/tvy7/549c8c77f55f049741a06596e5c1e01dacaa46d0-hi720.ts\n'+
'#EXTINF:5.000,{}\n'+
'/test/ts-files/tvy7/6cfa378684ffeb1c455a64dae6c103290a1f53d4-hi720.ts\n'+
'#EXT-X-ENDLIST'
