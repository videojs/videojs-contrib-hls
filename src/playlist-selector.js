/**
 * Selects playlist
 */
(function(window,videojs) {
    'use strict';
    var
        /**
         * A comparator function to sort two playlist object by bandwidth.
         * @param left {object} a media playlist object
         * @param right {object} a media playlist object
         * @return {number} Greater than zero if the bandwidth attribute of
         * left is greater than the corresponding attribute of right. Less
         * than zero if the bandwidth of right is greater than left and
         * exactly zero if the two are equal.
         */
        playlistBandwidth = function(left, right) {
            var leftBandwidth, rightBandwidth;
            if (left.attributes && left.attributes.BANDWIDTH) {
                leftBandwidth = left.attributes.BANDWIDTH;
            }
            leftBandwidth = leftBandwidth || window.Number.MAX_VALUE;
            if (right.attributes && right.attributes.BANDWIDTH) {
                rightBandwidth = right.attributes.BANDWIDTH;
            }
            rightBandwidth = rightBandwidth || window.Number.MAX_VALUE;

            return leftBandwidth - rightBandwidth;
        },

        /**
         * A comparator function to sort two playlist object by resolution (width).
         * @param left {object} a media playlist object
         * @param right {object} a media playlist object
         * @return {number} Greater than zero if the resolution.width attribute of
         * left is greater than the corresponding attribute of right. Less
         * than zero if the resolution.width of right is greater than left and
         * exactly zero if the two are equal.
         */
        playlistResolution = function(left, right) {
            var leftWidth, rightWidth;

            if (left.attributes && left.attributes.RESOLUTION && left.attributes.RESOLUTION.width) {
                leftWidth = left.attributes.RESOLUTION.width;
            }

            leftWidth = leftWidth || window.Number.MAX_VALUE;

            if (right.attributes && right.attributes.RESOLUTION && right.attributes.RESOLUTION.width) {
                rightWidth = right.attributes.RESOLUTION.width;
            }

            rightWidth = rightWidth || window.Number.MAX_VALUE;

            // NOTE - Fallback to bandwidth sort as appropriate in cases where multiple renditions
            // have the same media dimensions/ resolution
            if (leftWidth === rightWidth && left.attributes.BANDWIDTH && right.attributes.BANDWIDTH) {
                return left.attributes.BANDWIDTH - right.attributes.BANDWIDTH;
            } else {
                return leftWidth - rightWidth;
            }
        },

        PlaylistSelector = (function () {
            function PlaylistSelector() {
                this.bandwidth = 0;
                this.startTime = 0;
            }
            PlaylistSelector.prototype._now = function () {
                return (new Date()).valueOf();
            };

            /**
             * @returns {number}
             */
            PlaylistSelector.prototype.elapsed = function () {
                var self = this;
                return self._now() - self.startTime;
            };

            /**
             * Chooses the appropriate media playlist based on the current
             * bandwidth estimate and the player size.
             * @return the highest bitrate playlist less than the currently detected
             * bandwidth, accounting for some amount of bandwidth variance
             */
            PlaylistSelector.prototype.selectPlaylist = function (sortedPlaylists, width, height, bandwidth) {
                var self = this,
                    effectiveBitrate,
                    bandwidthPlaylists = [],
                    variant, bandwidthBestVariant,
                    i = sortedPlaylists.length,
                    resolutionBestVariant,
                    // a fudge factor to apply to advertised playlist bitrates to account for
                    // temporary flucations in client bandwidth
                    bandwidthVariance = 1.1;

                if(typeof bandwidth === "undefined") {
                    bandwidth = self.bandwidth;
                }

                sortedPlaylists.sort(playlistBandwidth);

                while (i--) {
                    variant = sortedPlaylists[i];

                    // ignore playlists without bandwidth information
                    if (!variant.attributes || !variant.attributes.BANDWIDTH) {
                        continue;
                    }

                    effectiveBitrate = variant.attributes.BANDWIDTH * bandwidthVariance;

                    if (effectiveBitrate < bandwidth) {
                        bandwidthPlaylists.push(variant);

                        // since the playlists are sorted in ascending order by
                        // bandwidth, the first viable variant is the best
                        if (!bandwidthBestVariant) {
                            bandwidthBestVariant = variant;
                        }
                    }
                }

                i = bandwidthPlaylists.length;

                // sort variants by resolution
                bandwidthPlaylists.sort(playlistResolution);

                // iterate through the bandwidth-filtered playlists and find
                // best rendition by player dimension
                while (i--) {
                    variant = bandwidthPlaylists[i];

                    // ignore playlists without resolution information
                    if (!variant.attributes ||
                        !variant.attributes.RESOLUTION ||
                        !variant.attributes.RESOLUTION.width ||
                        !variant.attributes.RESOLUTION.height) {
                        continue;
                    }

                    // since the playlists are sorted, the first variant that has
                    // dimensions less than or equal to the player size is the
                    // best
                    if (variant.attributes.RESOLUTION.width <= width &&
                        variant.attributes.RESOLUTION.height <= height) {
                        resolutionBestVariant = variant;
                        break;
                    }
                }

                // fallback chain of variants
                return resolutionBestVariant || bandwidthBestVariant || sortedPlaylists[0];
            };

            /**
             * HLSTransferListener implementation
             * Invoked when a transfer starts.
             */
            PlaylistSelector.prototype.onTransferStart = function () {
                this.startTime = this._now();
            };

            /**
             * HLSTransferListener implementation
             * Called incrementally during a transfer.
             *
             * @param bytesTransferred The number of bytes transferred since the previous call to this
             *     method (or if the first call, since the transfer was started).
             */
            PlaylistSelector.prototype.onBytesTransferred = function (bytesTransferred) {
                var self = this;
                self.bandwidth = (bytesTransferred / self.elapsed()) * 8 * 1000;
            };

            /**
             * HLSTransferListener implementation
             * Invoked when a transfer ends.
             */
            PlaylistSelector.prototype.onTransferEnd = function () {
            };
            return PlaylistSelector;
        })();
    videojs.Hls.PlaylistSelector = new PlaylistSelector();
})(window, window.videojs);
