import _ from 'lodash';
import {
  groupContiguous,
  quantiles,
  average,
} from './fn';

const isBuffered = (previous, current) => previous &&
                                          ((!previous.buffered && current.buffered) ||
                                           (previous.buffered && !current.buffered));

const sumTime = (regions) => _.sumBy(regions, ({
  start,
  end
}) => end - start);

// aggregate results from a simulation run
const summarizeSimulation = ({
  buffered,
  playlists
}) => {
  const bufferedGroups = groupContiguous(buffered, isBuffered);
  const bufferedRegions = _.map(bufferedGroups, (group, index) => {
    const prevGroup = bufferedGroups[index - 1];

    let start;
    let end = _.last(group).time;

    if (!prevGroup) {
      // first group, start is 0
      start = 0;
    } else {
      // there is a previous group, set start to be the end of the previous group
      start = _.last(prevGroup).time;
    }

    return {
      start,
      end,
      buffered: _.head(group).buffered
    };
  }).slice(0, bufferedGroups.length - 1);

  const emptyBufferedRegions = _.filter(bufferedRegions, ['buffered', 0]);

  return {
    startTime: _.get(_.find(buffered, 'buffered'), 'time', Infinity),
    rebufferRatio: sumTime(emptyBufferedRegions) / sumTime(bufferedRegions),
    rebufferCount: emptyBufferedRegions.length,
    indicatedBitrate: average(_.map(playlists, 'bitrate'))
  };
};

// append a simulation summary to a list of simulations
const appendToSimulations = ({
  startTimes,
  rebufferRatios,
  rebufferCounts,
  indicatedBitrates
}, simulation) => {
  const asc = _.subtract;

  const {
    startTime,
    rebufferRatio,
    rebufferCount,
    indicatedBitrate
  } = summarizeSimulation(simulation);

  return {
    startTimes: [...startTimes, startTime].sort(asc),
    rebufferRatios: [...rebufferRatios, rebufferRatio].sort(asc),
    rebufferCounts: [...rebufferCounts, rebufferCount].sort(asc),
    indicatedBitrates: [...indicatedBitrates, indicatedBitrate].sort(asc)
  };
};

// summarize results from several simulation runs
const summarizeSimulations = ({
  startTimes,
  rebufferRatios,
  rebufferCounts,
  indicatedBitrates
}) => {
  return {
    startTime: quantiles(startTimes),
    rebufferRatio: quantiles(rebufferRatios),
    rebufferCount: quantiles(rebufferCounts),
    indicatedBitrate: quantiles(indicatedBitrates),
  };
};

export { appendToSimulations, summarizeSimulations };
