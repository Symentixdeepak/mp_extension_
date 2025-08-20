// state.js - Manages global application state
const state = {
  elements: {},
  uiState: {},
  token: null,
};

function setState(key, value) {
  state[key] = value;
}

function getState(key) {
  return state[key];
}

module.exports = {
  state,
  setState,
  getState,
};
