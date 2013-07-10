(function(window) {

window.videojs.hls.FlvTag = function() {};

/*
package com.videojs.providers.hls.utils{

    import flash.utils.ByteArray;
    import flash.utils.Endian;

    public class FlvTag extends ByteArray
    {
        public static const AUDIO_TAG:uint    = 0x08;
        public static const VIDEO_TAG:uint    = 0x09;
        public static const METADATA_TAG:uint = 0x12;

        public var keyFrame:Boolean = false;
        private var extraData:Boolean = false;
        private var adHoc:uint = 0; // Counter if this is a metadata tag, nal start marker if this is a video tag. unused if this is an audio tag

        public var pts:uint;
        public var dts:uint;

        public static function isAudioFrame(tag:ByteArray):Boolean
        {
            return AUDIO_TAG == tag[0];
        }

        public static function isVideoFrame(tag:ByteArray):Boolean
        {
            return VIDEO_TAG == tag[0];
        }

        public static function isMetaData(tag:ByteArray):Boolean
        {
            return METADATA_TAG == tag[0];
        }

        public static function isKeyFrame(tag:ByteArray):Boolean
        {
            if ( isVideoFrame(tag) )
                return tag[11] == 0x17;

            if( isAudioFrame(tag) )
                return true;

            if( isMetaData(tag) )
                return true;

            return false;
        }

        public static function frameTime(tag:ByteArray):uint
        {
            var pts:uint = tag[ 4] << 16;
            pts |= tag[ 5] <<  8;
            pts |= tag[ 6] <<  0;
            pts |= tag[ 7] << 24;
            return pts;
        }


        public function FlvTag(type:uint, ed:Boolean = false)
        {
            super();
            extraData = ed;
            this.endian = Endian.BIG_ENDIAN;
            switch(type)
            {
                case VIDEO_TAG:    this.length = 16; break;
                case AUDIO_TAG:    this.length = 13; keyFrame = true; break;
                case METADATA_TAG: this.length = 29; keyFrame = true; break;
                default: throw("Error Unknown TagType");
            }

            this[0] = type
            this.position = this.length;
            keyFrame = extraData; // Defaults to false
            pts = dts = 0;
        }

        // Negative index into array
        public function negIndex(pos:uint):int
        {
            return this[this.length - pos];
        }

        // The functions below ONLY work when this[0] == VIDEO_TAG.
        // We are not going to check for that because we dont want the overhead
        public function nalUnitSize(nal:ByteArray = null):int
        {
            if( 0 == adHoc )
                return 0;

            return this.length - ( adHoc + 4 );
        }


        public function startNalUnit():void
        { // remember position and add 4 bytes
            if ( 0 < adHoc )
            {
                throw new Error("Attempted to create new NAL wihout closing the old one");
            }

            // reserve 4 bytes for nal unit size
            adHoc = this.length;
            this.length += 4;
            this.position = this.length;
        }

        public function endNalUnit(nal:ByteArray = null):void
        { // Rewind to the marker and write the size
            if ( this.length == adHoc + 4 )
            {
                this.length -= 4; // we started a nal unit, but didnt write one, so roll back the 4 byte size value
            }
            else
            if ( 0 < adHoc )
            {
                var nalStart:uint = adHoc + 4;
                var nalLength:uint = this.length - nalStart;

                this.position = adHoc;
                this.writeUnsignedInt( nalLength );
                this.position = this.length;

                if ( null != nal ) // If the user pass in a ByteArray, copy the NAL to it.
                    nal.writeBytes( this, nalStart, nalLength );
            }

            adHoc = 0;
        }

        public function writeMetaDataDouble(key:String, val:Number):void
        {
            writeShort    ( key.length );
            writeUTFBytes ( key );
            writeByte     ( 0x00 );
            writeDouble   ( val );
            ++adHoc;
        }

        public function writeMetaDataBoolean(key:String, val:Boolean):void
        {
            writeShort    ( key.length );
            writeUTFBytes ( key  );
            writeByte     ( 0x01 );
            writeByte     ( true == val ? 0x01 : 0x00 );
            ++adHoc;
        }

        public function finalize():ByteArray
        {
            switch(this[0])
            { // Video Data
             case VIDEO_TAG:
                this[11] = ( ( keyFrame || extraData ) ? 0x10 : 0x20 ) | 0x07; // We only support AVC, 1 = key frame (for AVC, a seekable frame), 2 = inter frame (for AVC, a non-seekable frame)
                this[12] = extraData ?  0x00 : 0x01;

                var dtsDelta:int = pts - dts;
                this[13] = ( dtsDelta & 0x00FF0000 ) >>> 16;
                this[14] = ( dtsDelta & 0x0000FF00 ) >>>  8;
                this[15] = ( dtsDelta & 0x000000FF ) >>>  0;
                break;

            case AUDIO_TAG:
                this[11] = 0xAF;
                this[12] = extraData ?  0x00 : 0x01;
                break;

            case METADATA_TAG:
                this.position = 11;
                writeByte(0x02); // String type
                writeShort(0x0A); // 10 Bytes
                writeUTFBytes("onMetaData");
                writeByte(0x08); // Array type
                writeUnsignedInt( adHoc );
                this.position = this.length;
                writeUnsignedInt( 0x09 ); // End Data Tag
                break;
            }

            var len:int = this.length - 11;

            this[ 1] = ( len & 0x00FF0000 ) >>> 16;
            this[ 2] = ( len & 0x0000FF00 ) >>>  8;
            this[ 3] = ( len & 0x000000FF ) >>>  0;
            this[ 4] = ( pts & 0x00FF0000 ) >>> 16;
            this[ 5] = ( pts & 0x0000FF00 ) >>>  8;
            this[ 6] = ( pts & 0x000000FF ) >>>  0;
            this[ 7] = ( pts & 0xFF000000 ) >>> 24;
            this[ 8] = 0;
            this[ 9] = 0;
            this[10] = 0;

            this.writeUnsignedInt( this.length );
            return this;
        }
    }
}
*/
})(this);
