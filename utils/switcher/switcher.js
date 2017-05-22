import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';
import Config from '../../src/config';
import defaultTrace from './network_logs/default.js';

const $ = document.querySelector.bind(document);

/* Data */

// Contains list of strings representing network traces uploaded
const networkTraces = [defaultTrace];
let results;

/* DOM elements */

// a dynamic number of time-bandwidth pairs may be defined to drive the simulation
const networkTimeline = $('.network-timeline');
const local = $('#local');
const saveReport = $('#save-report');
const clearReport = $('#clear-report');
const runButton = $('#run-simulation');

/* Listeners */

// clear the file path to allow for reload
local.addEventListener('click', () => local.value = '');
local.addEventListener('change', function() {
  // clear out previously loaded traces
  networkTraces.length = 0;
});

saveReport.addEventListener('click', function(){
  const result = $('#result').value;
  const data = new Blob([result], {type: 'text/plain'});

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

clearReport.addEventListener('click', function() {
  results = createResults(Object.keys(results));
  $('#result').innerText = tableToText(objToTable(results));
});

runButton.addEventListener('click', function() {
  runSimulations().then(function() {
    calculatedOKR();
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

const calculatedOKR = function() {
    // array contains all the selected bitrates
    let selectedBitrates = results['selected bitrates'].reduce((a, b) => a.concat(b));

    // sum all the selected bitrates value and the length
    let sumSelectedBitrates = results['selected bitrates'].reduce((a, b) => a.concat(b))
                                                          .reduce((a, b) => a + b);
    let selectedBitratesLength = results['selected bitrates'].reduce((a, b) => a.concat(b)).length;

    // array contains all the calculated bitrates
    let calculatedBitrates = results['calculated bandwidth [time bandwidth]'].reduce((a, b) => a.concat(b))
                                                                             .reduce((a, b) => a.concat(b[1]), []);
    // array contains all the rebuffer ratio
    let rebufferRatios = results['empty buffer regions [start end]'].reduce((a, b) => a.concat(b))
                                                                    .reduce((a, b) => a.concat((b[1] - b[0]) / 60000), []);

    const sum = {
      'run': results.run.length,
      'time to start': quantileMetrics(results['time to start']),
      'timeouts': results.timeouts.reduce((a, b) => a + b),
      'aborts': results.aborts.reduce((a, b) => a + b),
      'calculated bandwidth [time bandwidth]': quantileMetrics(calculatedBitrates),
      'selected bitrates': quantileMetrics(selectedBitrates),
      'rebuffering count': results['empty buffer regions [start end]'].reduce((acc, val) => acc + val.length - 1, 0),
      'indicated bitrates': sumSelectedBitrates / selectedBitratesLength,
      'rebuffer ratio': quantileMetrics(rebufferRatios)
    };
    $('#result').innerText = tableToText(objToTable(sum));
};

// collect the simulation parameters
const parameters = function(trace) {
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

  let goalBufferLength = Math.max(1, Number($('#goal-buffer-length').value));
  let bandwidthVariance = Math.max(0.1, Number($('#bandwidth-variance').value));

  return {
    goalBufferLength,
    bandwidthVariance,
    playlists,
    segments,
    networkTrace
  };
};

const simulationDone = function(promise, err, res) {
  const data = {
    'run': results ? results.run.length : 0,
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

  // create global result if it doesn't exist
  if (!results) {
    results = createResults(Object.keys(data));
  }

  // add this simulation result to the results
  Object.entries(data).forEach(([key, value]) => results[key].push(value));

  $('#result').innerText = tableToText(objToTable(results));

  displayTimeline(err, res);
  promise.resolve();
}

const runSimulations = () => loadFiles().then(() => {
  // network traces are loaded into `networkTraces`
  // now run the simulation through each one

  const simulationPromises = networkTraces.map((trace) => {
    return new Promise((resolve, reject) => {
      runSimulation(parameters(trace), simulationDone.bind(null, { resolve, reject }));
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

runButton.click();
