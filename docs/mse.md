# Media Source Extensions Notes
A collection of findings experimenting with Media Source Extensions on
Chrome 36.

* Specifying an audio and video codec when creating a source buffer
  but passing in an initialization segment with only a video track
  results in a decode error

## ISO Base Media File Format (BMFF)

### Init Segment
- `ftyp`
- `moov`
  - `mvex`

### Media Segment
The structure of a minimal media segment that actually encapsulates
movie data is outlined below:

- `moof`
  - `mfhd`
  - `traf`
    - `tfhd`
    - `tfdt`
    - `trun`
- `mdat`

### Structure

sample: time {number}, data {array}
chunk: samples {array}
track:  samples {array}
segment: moov {box}, mdats {array} | moof {box}, mdats {array}, data {array}

track
  chunk
    sample

movie fragment -> track fragment -> [samples]