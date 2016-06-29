import runSimulation from './run-simulation';
import displayTimeline from './display-timeline';



// a dynamic number of time-bandwidth pairs may be defined to drive the simulation
let networkTimeline = document.querySelector('.network-timeline');
let timePeriod = networkTimeline.querySelector('li:last-child').cloneNode(true);
const appendTimePeriod = function() {
  let clone = timePeriod.cloneNode(true);
  let count = networkTimeline.querySelectorAll('input.bandwidth').length;
  let time = clone.querySelector('.time');
  let bandwidth = clone.querySelector('input.bandwidth');

  time.name = 'time' + count;
  bandwidth.name = 'bandwidth' + count;
  networkTimeline.appendChild(clone);
};
document.querySelector('.add-time-period').addEventListener('click', appendTimePeriod);

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
  params.forEach(function(param) {
    appendTimePeriod();
    networkTimeline.querySelector('li:last-child .time').value = param[0];
    networkTimeline.querySelector('li:last-child input.bandwidth').value = param[1];
  });
}

// collect the simulation parameters
const parameters = function() {
  let times = Array.prototype.slice.call(document.querySelectorAll('.time'));
  let bandwidths = document.querySelectorAll('input.bandwidth');
  let playlists = Array.prototype.slice.call(document.querySelectorAll('input.bitrate'));

  return {
    playlists: playlists.map(function(input) {
      return +input.value;
    }),
    bandwidths: times.reduce(function(conditions, time, i) {
      return conditions.concat({
        time: +time.value,
        bandwidth: +bandwidths[i].value
      });
    }, [])
  };
};

let runButton = document.getElementById('run-simulation');
runButton.addEventListener('click', function() {
  runSimulation(parameters(), displayTimeline);
});

runButton.click();
