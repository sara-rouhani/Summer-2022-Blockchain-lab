'use strict';

const axios = require('axios');

let brokerServer = '140.193.92.239';
let brokerPort = '3000';

let axiosClient = axios.create({
  baseURL: `http://${brokerServer}:${brokerPort}`,
  headers: { "content-type": "application/json" }
});

axiosClient.interceptors.response.use(
  (res) => {
    if (res && res.data) {
      return res.data;
    }
    return res;
  },
  (error) => {
    throw error;
  }
);

module.exports = axiosClient;