import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';
import Config from '../../src/config';

// a dynamic number of time-bandwidth pairs may be defined to drive the simulation
let networkTimeline = document.querySelector('.network-timeline');
let $ = document.querySelector.bind(document);

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

// collect the simulation parameters
const parameters = function() {
  let networkTrace = $('#network-trace').value
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

let local = $('#local');
// clear the file path to allow for reload
local.addEventListener('click', () => local.value = '');
local.addEventListener('change', function() {
  const files = local.files;
  // do nothing if no file was chosen
  if (!files) {
    return;
  }

  if (files.length === 1) {
    var reader = new FileReader();
    reader.onloadend = function() {
      $('#network-trace').value = reader.result;
    };
    reader.readAsText(file);
    return;
  }
  $('#network-trace').style.display = 'none';
  var promise = Promise.resolve();
  Array.from(files).reduce(function(promise, file) {
    return promise.then(function() {
      return readFile(file);
    }).then(function() {
      return new Promise((resolve, reject) => runSimulations(resolve));
    });
  }, Promise.resolve())
});

const readFile = function(file) {
  return new Promise((resolve, reject) => {
    var reader = new FileReader();
    reader.onloadend = function() {
      $('#network-trace').value = reader.result;
      resolve();
    };
    reader.readAsText(file);
  })
};

const runSimulations = function(resolve) {
  runSimulation(parameters(), function(err, res) {
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
    if(resolve) resolve();
  });
};

let saveReport = $('#save-report');
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

// { foo: [1, 2], bar: [3, 4] } =>
// [[ foo, bar ],
//  [ 1,   3   ],
//  [ 2,   4   ]]
const objToTable = function(obj) {
  const rows = Object.values(obj)
    .reduce((rows, property) => {
      property.forEach((value, i) => {
        if (!Array.isArray(rows[i])) {
          rows[i] = [];
        }

        rows[i].push(value);
      });

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

const createResults = (keys) => keys .reduce((obj, key) => Object.assign(obj, {[key]: []}), {});
let runButton = document.getElementById('run-simulation');
let results;
runButton.addEventListener('click', function() {
  runSimulations();
});

runButton.click();

let clearReport = $('#clear-report');
clearReport.addEventListener('click', function() {
    results = createResults(Object.keys(results));
    $('#result').innerText = tableToText(objToTable(results));
});
