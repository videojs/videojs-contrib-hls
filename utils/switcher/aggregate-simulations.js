import _ from 'lodash';
import {
  groupContiguous,
  quantiles,
  average,
} from './fn';

const isBuffered = (previous, current) => previous && previous.buffered && current.buffered;
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
  const bufferedRegions = _.map(bufferedGroups, (group) => ({
    start: _.head(group).time,
    end: _.last(group).time,
    buffered: _.head(group).buffered
  }));

  const emptyBufferedRegions = _.filter(bufferedRegions, ['buffered', false]);

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