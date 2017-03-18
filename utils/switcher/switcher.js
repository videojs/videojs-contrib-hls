import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';



// a dynamic number of time-bandwidth pairs may be defined to drive the simulation
let networkTimeline = document.querySelector('.network-timeline');

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
  let networkTrace = document.querySelector('#network-trace').value;
  let playlists = Array.prototype.slice.call(document.querySelectorAll('input.bitrate'));

  return {
    playlists: playlists.map(function(input) {
      return +input.value;
    }),
    networkTrace
  };
};

let runButton = document.getElementById('run-simulation');
runButton.addEventListener('click', function() {
  runSimulation(parameters(), displayTimeline);
});

runButton.click();
