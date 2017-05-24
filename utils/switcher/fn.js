import _ from 'lodash';

const $ = document.querySelector.bind(document);

const average = list => _.sum(list) / list.length;

const quantiles = (list) => {
  const q = _.partial(d3.quantile, list);

  return {
    '25': q(0.25),
    '50': q(0.50),
    '90': q(0.90),
    '95': q(0.95),
    '99': q(0.99),
    'max': q(1)
  };
}

// create contiguous groups
// [1,2,4,5] ((x,y) => y-x === 1 ) = [[1,2][4,5]]
const groupContiguous = (list, condition) =>
  _.reduce(list, (groups, element, i) => {
    const previousElement = list[i - 1];

    // start a new group if no longer contigious
    const changed = !previousElement || condition(previousElement, element);
    const groupIndex = changed ? groups.length : groups.length - 1;
    const selectedGroup = groups[groupIndex] || [];

    groups[groupIndex] = [...selectedGroup, element];

    return groups;
  }, []);

export { $, average, quantiles, groupContiguous };
