(function() {

window.videojs.hls.ExpGolomb = function() {};

/*
      public class ExpGolomb
    {
        private var workingData:ByteArray;
        private var workingWord:uint;
        private var workingbBitsAvailable:uint;

        public function ExpGolomb(pData:ByteArray)
        {
            workingData = pData;
            workingData.position = 0;
            loadWord();
        }

        public function length():uint
        {
            return ( 8 * workingData.length );
        }

        public function bitsAvailable():uint
        {
            return ( 8 * workingData.bytesAvailable ) + workingbBitsAvailable;
        }

        private function loadWord():void
        {
            workingWord = 0; workingbBitsAvailable = 0;
            switch( workingData.bytesAvailable )
            {
                case 0: workingbBitsAvailable = 0; break;
                default: // not 0, but greater than 4
                case 4: workingWord =                        workingData.readUnsignedByte(); workingbBitsAvailable  = 8;
                case 3: workingWord = ( workingWord << 8 ) | workingData.readUnsignedByte(); workingbBitsAvailable += 8;
                case 2: workingWord = ( workingWord << 8 ) | workingData.readUnsignedByte(); workingbBitsAvailable += 8;
                case 1: workingWord = ( workingWord << 8 ) | workingData.readUnsignedByte(); workingbBitsAvailable += 8;
            }

            workingWord <<= (32 - workingbBitsAvailable);
        }

        public function skipBits(size:int):void
        {
            if ( workingbBitsAvailable > size )
            {
                workingWord          <<= size;
                workingbBitsAvailable -= size;
            }
            else
            {
                size -= workingbBitsAvailable;
                var skipBytes:int = size / 8;

                size                 -= ( skipBytes * 8 );
                workingData.position += skipBytes;

                loadWord();

                workingWord          <<= size;
                workingbBitsAvailable -= size;
            }
        }

        public function readBits(size:int):uint
        {
//            if ( 32 < size )
//                throw new Error("Can not read more than 32 bits at a time");

            var bits:uint     = ( workingbBitsAvailable < size ?  workingbBitsAvailable : size);
            var valu:uint     = workingWord >>> (32 - bits);

            workingbBitsAvailable -= bits;
            if ( 0 < workingbBitsAvailable )
                workingWord <<= bits;
            else
                loadWord();

            bits = size - bits;
            if ( 0 < bits )
                return valu << bits | readBits( bits );
            else
                return valu;
        }

        private function skipLeadingZeros():uint
        {
            for( var clz:uint = 0 ; clz < workingbBitsAvailable ; ++clz )
            {
                if( 0 != ( workingWord & ( 0x80000000 >>> clz ) ) )
                {
                    workingWord          <<= clz;
                    workingbBitsAvailable -= clz;
                    return clz;
                }
            }

            loadWord(); // we exhausted workingWord and still have not found a 1
            return clz + skipLeadingZeros();
        }

        public function skipUnsignedExpGolomb():void
        {
            skipBits(1 + skipLeadingZeros() );
        }

        public function skipExpGolomb():void
        {
            skipBits(1 + skipLeadingZeros() );
        }

        public function readUnsignedExpGolomb():uint
        {
            var clz:uint = skipLeadingZeros();
            return readBits(clz+1) - 1;
        }

        public function readExpGolomb():int
        {
            var valu:int = readUnsignedExpGolomb();
            if ( 0x01 & valu ) // the number is odd if the low order bit is set
                return (1 + valu) >>> 1; // add 1 to make it even, and devide by 2
            else
                return -1 * (valu >>> 1); // devide by two then make it negative
        }

        // Some convenience functions
        public function readBoolean():Boolean
        {
            return 1 == readBits(1);
        }

        public function readUnsignedByte():int
        {
            return readBits(8);
        }
    }
*/
})();
