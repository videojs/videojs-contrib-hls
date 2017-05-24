import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';
import Config from '../../src/config';
import defaultTrace from './network_logs/default.js';
import {
  appendToSimulations,
  summarizeSimulation,
  summarizeSimulations
} from './report';
import { $ } from './fn';

/**
 * DOM
 */
const networkTimeline = $('.network-timeline');

const reportEl = $('#report');

const local = $('#local');
local.addEventListener('click', localClick);
// clear the file path to allow for reload
local.addEventListener('change', localChange);

/**
 * Save the simluation summary object
 */
const saveReport = $('#save-report');
saveReport.addEventListener('click', function() {
  const data = new Blob([simulationSummary], {
    type: 'text/plain'
  });

  let textFile = window.URL.createObjectURL(data);

  let link = document.createElement('a');
  link.setAttribute('download', 'report.json');
  link.href = textFile;
  document.body.appendChild(link);

  window.requestAnimationFrame(function() {
    let event = new MouseEvent('click');
    link.dispatchEvent(event);
    document.body.removeChild(link);
    window.URL.revokeObjectURL(textFile);
  });
});

const clearReport = $('#clear-report');

const runButton = $('#run-simulation');
runButton.addEventListener('click', run);

const fuzzInputs = $('#fuzz-inputs');
fuzzInputs.addEventListener('change', function() {
  secondaryInputs.forEach((el) => {
    el.style.display = fuzzInputs.checked ? 'block' : 'none';
  });
});

const waitingNote = $('#running-simulation');

const finishedNote = $('#finished-simulation');

const secondaryInputs = [
  $('#goal-buffer-length-secondary'),
  // $('#bandwidth-variance-secondary')
];

/**
 * Logic
 */

/**
 * Variable to contain summarization of simluations
 */
let simulationOptions = {};
let simulationSummary;

/**
 * Run simulation
 */
const run = () => {
  // collect state of the application
  //   options
  //   files
  // run simulation for each file
  //   summarize simulation result
  // summarize the simulations
  // hide UI elements as necessary
  //   show if only one file

  let simulations =  {
    startTimes: [],
    rebufferRatios: [],
    rebufferCounts: [],
    indicatedBitrates: []
  };

  do(getOptions())
    .then((result) => {
      simulations = appendToSimulations(simulations, summarizeSimulation(result));
    }).then(() => {
      simulationSummary = summarizeSimulations(simulations);
    }).then(() => hideUI(getOptions()));
};
