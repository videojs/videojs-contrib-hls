let cached = [
    4259214,
   19076326,
   28522700,
   39653500,
   43366545,
   49809078,
   50211789,
   68145142,
  116338947,
  233843368
];

let nonCached = [
  11652263,
  14916902,
  14937777,
  16079478,
  20203563,
  20523185,
  22069584,
  29610560,
  32307529,
  32831170
];

const swap = (arr) => (a, b) => {
  const tmp = arr[b];
  arr[b] = arr[a];
  arr[a] = tmp;
};

const shuffle = function (arr) {
  const newArr = arr.slice();
  const swapper = swap(newArr);
  const count = newArr.length;

  for (let i = 0; i < count; i++) {
    const o = Math.floor(Math.random() * count);
    swapper(i, o);
  }
  return newArr;
};

const both = cached.concat(nonCached);

const getStats = (arr) => {
  let samples = arr.length;
  let halfArrayCount = samples / 2;
  let medianIndex = Math.floor(halfArrayCount);
  let arrInMbps = arr.map(v => v/1048576);
  let sortedArr = arrInMbps.sort((a, b) => b - a);
  let sum = arrInMbps.reduce((acc, v) => acc + v, 0);
  let recipSum = arrInMbps.reduce((acc, v) => acc + 1 / v, 0);
  let mean = sum / samples;
  let hMean = samples / recipSum;

  let sumSq = arrInMbps.reduce((acc, v) => Math.pow(v - mean, 2));
  let variance = sumSq / (samples - 1);
  let stdDev = Math.sqrt(variance);

  let median = sortedArr[medianIndex];
  if (medianIndex !== halfArrayCount) {
    median += sortedArr[medianIndex + 1];
    median /= 2;
  }

  return {
    median,
    hMean,
    mean,
    variance,
    stdDev
  };
};

const push = (arr, val) => {
  if (arr.length < 3) {
    arr.push(val);
    return arr;
  }

  const valInMbps = val / 1048576;
  const stats = getStats(arr);

  if (valInMbps < stats.mean) {
    arr.push(val);
  } else if (Math.abs(valInMbps - stats.median) < stats.stdDev * 2) {
    arr.push(val);
  }

  return arr;
};

console.log('non-cached', getStats(nonCached));
console.log('both', getStats(both));
console.log('cached', getStats(cached));
console.log('filtered 1', getStats(shuffle(both).reduce(push, [])));
console.log('filtered 2', getStats(shuffle(both).reduce(push, [])));
console.log('filtered 3', getStats(shuffle(both).reduce(push, [])));
console.log('filtered 4', getStats(shuffle(both).reduce(push, [])));

const irwinHallDist = (mean, variance) => {
  let randomIterations = variance * 12;
  let sum = 0;

  while (randomIterations > 0) {
    if (randomIterations > 1) {
      sum += Math.random();
    } else {
      sum += Math.random() * randomIterations;
    }
    randomIterations -= 1;
  }

  return sum - (variance * 6) + mean;
};

non-cached Object {median: 19.267619132995605, mean: 20.516587352752687, variance: 8.843753695330783, stdDev: 2.973844934647868}
both Object {median: 27.201366424560547, mean: 41.40656566619873, variance: 69.73119148306473, stdDev: 8.350520431869185}
cached Object {median: 41.35756015777588, mean: 62.296543979644774, variance: 339.127341004234, stdDev: 18.415410421824273}

filtered 1 Object {median: 18.73011064529419, mean: 21.134318351745605, variance: 22.420566611283622, stdDev: 4.735036072859807}
filtered 2 Object {median: 19.267619132995605, mean: 23.985815116337367, variance: 28.35444814459994, stdDev: 5.324889495998948}
filtered 3 Object {median: 18.73011064529419, mean: 20.359158589289738, variance: 20.43081074973957, stdDev: 4.520045436689721}
filtered 4 Object {median: 20.309814929962158, mean: 35.93153033537023, variance: 59.74547920606813, stdDev: 7.729519985488629}
