// d3-force ships ESM only, which jest cannot parse. Component tests that render
// the graph canvas use the radial layout and never run the simulation, so the
// forces only need to exist as callable stubs.
const stub = () => jest.fn();

module.exports = {
  forceCenter: stub,
  forceCollide: stub,
  forceLink: stub,
  forceManyBody: stub,
  forceSimulation: stub,
  forceX: stub,
  forceY: stub,
};
