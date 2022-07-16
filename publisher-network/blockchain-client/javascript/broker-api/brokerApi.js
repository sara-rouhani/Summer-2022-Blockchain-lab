const axiosClient = require ('./axiosClient.js');

let brokerApi = {
  connectToAgent: ({invitationUrl}) => {
    let url = '/connectToAgent';
    return axiosClient.post(url, {invitationUrl});
  },
  queryTopic: ({topicNumber}) => {
    let url = '/queryTopic';
    return axiosClient.post(url, {topicNumber});
  },
  createTopic: ({topicNumber, topicName, publisher, subscribers, message}) => {
    let url = '/createTopic';
    return axiosClient.post(url, {topicNumber, topicName, publisher, subscribers, message});
  },
  publishToTopic: ({topicNumber, message}) => {
    let url = '/publishToTopic';
    return axiosClient.post(url, {topicNumber, message});
  },
  queryAllTopics: () => {
    let url = '/queryAllTopics';
    return axiosClient.get(url);
  }
}

module.exports = brokerApi;