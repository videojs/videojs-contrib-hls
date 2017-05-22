import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';
import Config from '../../src/config';
import defaultTrace from './network_logs/default.js';

const $ = document.querySelector.bind(document);

/* Data */

// Contains list of strings representing network traces uploaded
const networkTraces = [defaultTrace];
const resultKeys = [
  'run',
  'time to start',
  'timeouts',
  'aborts',
  'calculated bandwidth [time bandwidth]',
  'selected bitrates',
  'empty buffer regions [start end]']
const results = [];

/* DOM elements */

// a dynamic number of time-bandwidth pairs may be defined to drive the simulation
const networkTimeline = $('.network-timeline');
const local = $('#local');
const saveReport = $('#save-report');
const clearReport = $('#clear-report');
const runButton = $('#run-simulation');
const fuzzInputs = $('#fuzz-inputs');
const waitingNote = $('#running-simulation');
const finishedNote = $('#finished-simulation');
const secondaryInputs = [
  $('#goal-buffer-length-secondary'),
  // $('#bandwidth-variance-secondary')
];

waitingNote.style.display = 'none';
finishedNote.style.display = 'none';

/* Listeners */

// clear the file path to allow for reload
local.addEventListener('click', () => local.value = '');
local.addEventListener('change', function() {
  // clear out previously loaded traces
  networkTraces.length = 0;
});

saveReport.addEventListener('click', function(){
  const stringifiedResults = results.map((simulation) => {
    return JSON.stringify({
      result: simulation.text,
      inputs: simulation.inputs,
      okr: simulation.okr
    }, null, 2);
  });
  const data = new Blob([stringifiedResults.join(',')], {type: 'text/plain'});

  let textFile = window.URL.createObjectURL(data);

  let link = document.createElement('a');
  link.setAttribute('download', 'report.csv');
  link.href = textFile;
  document.body.appendChild(link);

  window.requestAnimationFrame(function () {
    let event = new MouseEvent('click');
    link.dispatchEvent(event);
    document.body.removeChild(link);
    window.URL.revokeObjectURL(textFile);
  });
});

fuzzInputs.addEventListener('change', function() {
  secondaryInputs.forEach((el) => {
    el.style.display = fuzzInputs.checked ? 'block' : 'none';
  });
});

runButton.addEventListener('click', function() {
  // clear previous simulation before starting a new one
  results.length = 0;

  // Setup the simulation inputs
  // [ [GoalBufferLength, BandwidthVariance], ... ]
  const simulationInputs = setupSimulationInputs();

  // This gets REALLY SLOW
  const runs = simulationInputs.map((inputs, index) => {
    return runSimulations(index, inputs).then(() => {
      calculatedOKR(index);
    });
  });

  waitingNote.style.display = 'block';
  finishedNote.style.display = 'none';

  Promise.all(runs).then(() => {
    finishedNote.style.display = 'block';
    waitingNote.style.display = 'none';

    // If only one simulation was run over one trace, display the timeline graph of the
    // results and add the text results to the display
    if (results.length === 1 && networkTraces.length === 1) {
      displayTimeline(results[0].error, results[0].raw_result);
      $('#result').innerText = results[0].text;
    }
  });
});

/* Functions */

// { foo: [1, 2], bar: [3, 4] } =>
// [[ foo, bar ],
//  [ 1,   3   ],
//  [ 2,   4   ]]
const objToTable = function(obj) {
  const rows = Object.values(obj)
    .reduce((rows, property) => {
      if (!Array.isArray(rows[0])) {
        rows[0] = [];
      }
      rows[0].push(property);
      return rows;
    }, []);

  return [
    Object.keys(obj),
    ...rows
  ];
};

// [header, [values...]...] => header\nvalues,values
const tableToText = function([header, ...rows], delimiter=',') {
  const quote = (x) => Array.isArray(x) ? `"${JSON.stringify(x)}"` : x;

  return [
    header.join(delimiter),
    ...rows.map((row) => row.map(quote).join(delimiter))
  ].join('\n');
};

const createResults = (keys) => keys.reduce((obj, key) => Object.assign(obj, {[key]: []}), {});

const loadFiles = () => {
  const files = local.files;

  // do nothing if no file was chosen or if we already have networkTraces loaded
  // networkTraces is cleared whenever the FilePicker changes, so the having a trace
  // means we've already loaded a file
  if (!files || networkTraces.length) {
    return Promise.resolve();
  }

  const filePromises = Array.from(files).map((file) => readFile(file));

  return Promise.all(filePromises);
};

const readFile = function(file) {
  return new Promise((resolve, reject) => {
    var reader = new FileReader();
    reader.onloadend = function() {
      networkTraces.push(reader.result);
      resolve();
    };
    reader.readAsText(file);
  })
};

const quantileMetrics = function(array) {
  array.sort((a, b) => a - b);
  return [0.25, 0.5, 0.9, 0.95, 0.99].reduce((a, b) => a.concat(d3.quantile(array, b)), []);
};

const calculatedOKR = function(simulation) {
  let simulationResults = results[simulation].result;
  // array contains all the selected bitrates
  let selectedBitrates = simulationResults['selected bitrates'].reduce((a, b) => a.concat(b));

  // sum all the selected bitrates value and the length
  let sumSelectedBitrates = simulationResults['selected bitrates'].reduce((a, b) => a.concat(b))
                                                        .reduce((a, b) => a + b);
  let selectedBitratesLength = simulationResults['selected bitrates'].reduce((a, b) => a.concat(b)).length;

  // array contains all the calculated bitrates
  let calculatedBitrates = simulationResults['calculated bandwidth [time bandwidth]'].reduce((a, b) => a.concat(b))
                                                                           .reduce((a, b) => a.concat(b[1]), []);
  // array contains all the rebuffer ratio
  let rebufferRatios = simulationResults['empty buffer regions [start end]'].reduce((a, b) => a.concat(b))
                                                                  .reduce((a, b) => a.concat((b[1] - b[0]) / 60000), []);

  const sum = {
    'run': simulationResults.run.length,
    'time to start': quantileMetrics(simulationResults['time to start']),
    'timeouts': simulationResults.timeouts.reduce((a, b) => a + b),
    'aborts': simulationResults.aborts.reduce((a, b) => a + b),
    'calculated bandwidth [time bandwidth]': quantileMetrics(calculatedBitrates),
    'selected bitrates': quantileMetrics(selectedBitrates),
    'rebuffering count': simulationResults['empty buffer regions [start end]'].reduce((acc, val) => acc + val.length - 1, 0),
    'indicated bitrates': sumSelectedBitrates / selectedBitratesLength,
    'rebuffer ratio': quantileMetrics(rebufferRatios)
  };

  results[simulation].okr = tableToText(objToTable(sum));
};

const setupSimulationInputs = function() {
  let result = [];

  // First create arrays for each fuzzed input
  const fuzz = fuzzInputs.checked;

  // Goal Buffer Length
  const GBLValues = fuzz ? fuzzGoalBufferLength() : [Math.max(1, Number($('#goal-buffer-length').value))];
  // Bandwidth Variance
  // const BVValues = fuzz ? fuzzBandwidthVariance() : [Math.max(0.1, Number($('#bandwidth-variance').value))];
  const BVValues = [Math.max(0.1, Number($('#bandwidth-variance').value))];

  const values = [GBLValues, BVValues];

  const merger = function(arr, type) {
    for (let i = 0, l = values[type].length; i < l; i++) {
      const clone = arr.slice(0);

      clone.push(values[type][i]);

      if (type === values.length - 1) {
        result.push(clone);
      } else {
        merger(clone, type + 1);
      }
    }
  };

  merger([], 0);
  return result;
};

const fuzzGoalBufferLength = function() {
  let result = [];

  let GBL = Math.max(1, Number($('#goal-buffer-length').value));
  let GBLStep = Math.max(1, Number($('#goal-buffer-length-step').value));
  let GBLMax = Math.max(GBL, Number($('#goal-buffer-length-max').value));

  result.push(GBL);

  while(GBL + GBLStep <= GBLMax) {
    GBL += GBLStep;
    result.push(GBL);
  }

  return result;
};

const fuzzBandwidthVariance = function() {
  let result = [];

  let BV = Math.max(0.1, Number($('#bandwidth-variance').value));
  let BVStep = Math.max(0.1, Number($('#bandwidth-variance-step').value));
  let BVMax = Math.max(BV, Number($('#bandwidth-variance-max').value));

  result.push(BV);

  while(BV + BVStep <= BVMax) {
    BV += BVStep;
    result.push(BV);
  }

  return result;
};

// collect the simulation parameters
const parameters = function(trace, inputs) {
  let networkTrace = trace
    .trim()
    .split('\n')
    .map((line) => line.split(' ').slice(-2).map(Number));
  let playlists = $('#bitrates').value
    .trim()
    .split('\n')
    .map((line) => {
      let t = line.split(/[,\s]+/).map(Number);
      return [t[0], t[1] || t[0]];
    });

  let segments = {};
  try {
    segments = JSON.parse($('#segments').value);
  } catch(e) {
    console.log('Invalid JSON');
  }

  // inputs: [goalBufferLength, bandwidthVariance]

  return {
    goalBufferLength: inputs[0],
    bandwidthVariance: inputs[1],
    playlists,
    segments,
    networkTrace
  };
};

const simulationDone = function(promise, simulation, err, res) {
  // create global result if it doesn't exist
  if (!results[simulation].result) {
    results[simulation].result = createResults(resultKeys);
  }

  const simulationResults = results[simulation].result;
  const data = {
    'run': simulationResults ? simulationResults.run.length : 0,
    'time to start': res.buffered.find(({buffered}) => buffered).time,
    'timeouts': res.playlists.filter(({timedout}) => timedout).length,
    'aborts': res.playlists.filter(({aborted}) => aborted).length,
    'calculated bandwidth [time bandwidth]': res.effectiveBandwidth.map(({time, bandwidth}) => [time, bandwidth]),
    'selected bitrates': res.playlists.map(({bitrate}) => bitrate),
    'empty buffer regions [start end]': res.buffered.reduce(function(result, sample, index) {
      var last = result[result.length - 1];

      if (sample.buffered === 0) {
        if (last && last.index === index - 1) {
          // add this sample to the interval we're accumulating
          last.end = sample.time;
          last.index = index;
        } else {
          // this sample starts a new interval
          result.push({
            start: sample.time,
            end: sample.time,
            index: index
          });
        }
      }
      // filter out time periods where the buffer isn't empty
      return result;
    }, []).map(({start, end}) => [start, end])
  };

  // add this simulation result to the results
  Object.entries(data).forEach(([key, value]) => simulationResults[key].push(value));

  results[simulation].text = tableToText(objToTable(simulationResults));

  // Store the raw results and error of the simulation
  // This is only useful in the event that a single simulation was done over a single
  // network trace, otherwise these values will only be valid for the last network trace
  // used for the given simulation
  results[simulation].raw_result = res;
  results[simulation].error = err;

  promise.resolve();
}

const runSimulations = (simulation, inputs) => loadFiles().then(() => {
  // create the simulation ov=bject if it does not already exist
  if (!results[simulation]) {
    results[simulation] = {
      inputs
    };
  }

  // network traces are loaded into `networkTraces`
  // now run the simulation through each one
  const simulationPromises = networkTraces.map((trace) => {
    return new Promise((resolve, reject) => {
      runSimulation(parameters(trace, inputs), simulationDone.bind(null, { resolve, reject }, simulation));
    });
  });

  return Promise.all(simulationPromises);
});

/* Run */

// Does this even do anything?
// apply any simulation parameters that were set in the fragment identifier
if (window.location.hash) {
  // time periods are specified as t<seconds>=<bitrate>
  // e.g. #t15=450560&t150=65530
  let params = window.location.hash.substring(1)
    .split('&')
    .map(function(param) {
      return ((/t(\d+)=(\d+)/i).exec(param) || [])
        .map(window.parseFloat).slice(1);
    }).filter(function(pair) {
      return pair.length === 2;
    });

  networkTimeline.innerHTML = '';
}

// runButton.click();
