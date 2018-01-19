import _ from 'lodash';
import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';
import Config from '../../src/config';
import defaultTrace from './network_logs/default.js';
import { $ } from './fn';
import { appendToSimulations, summarizeSimulations } from './aggregate-simulations';

/* Data */

// Contains list of strings representing network traces uploaded
const networkTraces = [defaultTrace];
const defaultResults = {
  startTimes: [],
  rebufferRatios: [],
  rebufferCounts: [],
  indicatedBitrates: []
};
const createResults = () => _.cloneDeep(defaultResults);
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
  $('#buffer-low-water-line-secondary')
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
  const rows = results.map(({ inputs, summary }) =>({ inputs, summary }));
  const data = new Blob([JSON.stringify(rows, null, 2)], {type: 'text/plain'});

  let textFile = window.URL.createObjectURL(data);

  let link = document.createElement('a');
  link.setAttribute('download', 'report.json');
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

  waitingNote.style.display = 'block';
  finishedNote.style.display = 'none';

  // Setup the simulation inputs
  // [ [GoalBufferLength, BandwidthVariance], ... ]
  const simulationInputs = setupSimulationInputs();

  // This gets REALLY SLOW
  const runs = simulationInputs.map((inputs, index) => {
    return runSimulations(index, inputs);
  });

  Promise.all(runs).then(() => {
    finishedNote.style.display = 'block';
    waitingNote.style.display = 'none';

    // If only one simulation was run over one trace, display the timeline graph of the
    // results and add the text results to the display
    if (results.length === 1 && networkTraces.length === 1) {
      $('#result').style.display = 'none';
      displayTimeline(results[0].error, results[0].raw_result);
      // hide JSON summary if there's only one simulation run
    } else {
      $('#result').style.display = 'block';
      $('#result').innerText = JSON.stringify(results);
    }
  });
});

/* Functions */

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

const setupSimulationInputs = function() {
  let result = [];

  // First create arrays for each fuzzed input
  const fuzz = fuzzInputs.checked;

  // Goal Buffer Length
  const GBLValues = fuzzInput('goal-buffer-length', fuzz, 1, 1);
  // Buffer Low-Water Line
  const BLWLValues = fuzzInput('buffer-low-water-line', fuzz, 0, 1);
  // Bandwidth Variance
  const BVValues = fuzzInput('bandwidth-variance', false, 0.1, 0.1);

  const values = [GBLValues, BLWLValues, BVValues];

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

const fuzzInput = function(input, useMax, inputMin, inputStepMin) {
  const result = [];

  let value = Math.max(inputMin, Number($(`#${input}`).value));
  let step = Math.max(inputStepMin, Number($(`#${input}-step`).value));
  let max = value;

  if (useMax) {
    max = Math.max(max, Number($(`#${input}-max`).value));
  }

  for (; value <= max; value += step) {
    result.push(value);
  }

  return result;
}

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

  // inputs: [goalBufferLength, bufferLowWaterLine, bandwidthVariance]

  return {
    goalBufferLength: inputs[0],
    bufferLowWaterLine: inputs[1],
    bandwidthVariance: inputs[2],
    playlists,
    segments,
    networkTrace
  };
};

const simulationDone = function(promise, simulation, err, res) {
  // create global summary if it doesn't exist
  if (!results[simulation].results) {
    results[simulation].results = createResults();
  }

  // recalculate summary with new result
  results[simulation].results = appendToSimulations(results[simulation].results, res);
  results[simulation].summary = summarizeSimulations(results[simulation].results);

  // Store the raw results and error of the simulation
  // This is only useful in the event that a single simulation was done over a single
  // network trace, otherwise these values will only be valid for the last network trace
  // used for the given simulation
  results[simulation].raw_result = res;
  results[simulation].error = err;

  promise.resolve();
}

const runSimulations = (simulation, inputs) => loadFiles().then(() => {
  // create the simulation object if it does not already exist
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

// initially hide the JSON summary output
$('#result').style.display = 'none';

// runButton.click();
