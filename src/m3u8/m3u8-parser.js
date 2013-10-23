(function(window) {
	 	var M3U8 = window.videojs.hls.M3U8;

		window.videojs.hls.M3U8Parser = function() {

        var self = this;
	      var tagTypes = window.videojs.hls.m3u8TagType;
	      var lines = [];
	      var data;

	      self.getTagType = function( lineData ) {
					for ( var s in tagTypes )
					{
						if (lineData.indexOf(tagTypes[s]) == 0)
						{
							return tagTypes[s];
						}
					}
	      }

	      self.getTagValue = function ( lineData ) {
		      for ( var s in tagTypes )
		      {
			      if (lineData.indexOf(tagTypes[s]) == 0)
			      {
				      return lineData.substr(tagTypes[s].length);
			      }
		      }
	      }

	      self.parse = function( rawDataString ) {
		      data = new M3U8();

	        if( rawDataString != undefined && rawDataString.toString().length > 0 )
		      {
			      lines = rawDataString.split('\n');

			        lines.forEach(
					      function(value,index) {
							    switch( self.getTagType(value) )
							    {
								    case tagTypes.EXTM3U:
									    data.hasValidM3UTag = (index == 0);
									    if(!data.hasValidM3UTag)
									    {
										    data.invalidReasons.push("Invalid EXTM3U Tag");
									    }
									    break;

								    case tagTypes.DISCONTINUITY:
									    break;

								    case tagTypes.PLAYLIST_TYPE:
									    if(self.getTagValue(value) == "VOD" || self.getTagValue(value) == "EVENT")
									    {
										    data.playlistType = self.getTagValue(value);
										    data.isPlaylist = true;
									    } else {
										    data.invalidReasons.push("Invalid Playlist Type Value");
									    }
									    break;

								    case tagTypes.EXTINF:
									    var segment = {url: "unknown", byterange: -1, targetDuration: data.targetDuration };

									    if( self.getTagType(lines[index+1]) == tagTypes.BYTERANGE )
									    {
										    segment.byterange = self.getTagValue(lines[index+1]).split('@');
										    segment.url = lines[index+2];
									    } else
									    {
										    segment.url = lines[index+1];
									    }

									    data.mediaItems.push(segment);

									    break;

								    case tagTypes.STREAM_INF:
									    var rendition = {};
									    var attributes = value.substr(tagTypes.STREAM_INF.length).split(',');

									    attributes.forEach(function(attr_value,attr_index) {
										  	if(isNaN(attr_value.split('=')[1])){
												  rendition[attr_value.split('=')[0].toLowerCase()] = attr_value.split('=')[1];

												  if(rendition[attr_value.split('=')[0].toLowerCase()].split('x').length = 2)
												  {
														rendition.resolution = {
													    width: Number(rendition[attr_value.split('=')[0].toLowerCase()].split('x')[0]),
													    height: Number(rendition[attr_value.split('=')[0].toLowerCase()].split('x')[1])
												    }
												  }

												} else {
											    rendition[attr_value.split('=')[0].toLowerCase()] = Number(attr_value.split('=')[1]);
										    }
									    });


									    if( self.getTagType(lines[index+1]) == tagTypes.BYTERANGE )
									    {
										    rendition.byterange = self.getTagValue(lines[index+1]).split('@');
										    rendition.url = lines[index+2];
									    } else
									    {
										    rendition.url = lines[index+1];
									    }

									    data.isPlaylist = true;
									    data.playlistItems.push(rendition);
									    break;

								    case tagTypes.TARGETDURATION:
									    data.targetDuration = Number(self.getTagValue(value).split(',')[0]);
									    break;

								    case tagTypes.ZEN_TOTAL_DURATION:
									    data.totalDuration = self.getTagValue(value);
									    break;

								    case tagTypes.VERSION:
									    data.version = Number(self.getTagValue(value));
									    break;

								    case tagTypes.MEDIA_SEQUENCE:
									    data.mediaSequence = parseInt(self.getTagValue(value));
									    break;

								    case tagTypes.ALLOW_CACHE:
									    if(self.getTagValue(value) == "YES" || self.getTagValue(value) == "NO")
									    {
										    data.allowCache = self.getTagValue(value);
									    } else {
										    data.invalidReasons.push("Invalid ALLOW_CACHE Value");
									    }
									    break;

								    case tagTypes.ENDLIST:
									    data.hasEndTag = true;
									    break;
							    }
					      }
				      )
				  } else {
		        data.invalidReasons.push("Empty Manifest");
		      }

		      return data;

	      };
    };

})(this);