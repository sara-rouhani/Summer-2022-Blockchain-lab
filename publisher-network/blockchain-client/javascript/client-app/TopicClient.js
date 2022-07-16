'use strict';

const {connect} = require('./connectUtil');
const brokerApi = require('../broker-api/brokerApi');

class TopicClient {

  channelName = 'mychannel';
  chaincodeName = 'topic';

  static async build(connectConfig) {
    const clientApi = new TopicClient();
    clientApi.gateway = await connect(connectConfig);
    return clientApi;
  }

  // async initConnection(connectConfig) {
  //   this.gateway = await connect(connectConfig);
  // }

  async connectToAgent(args) {
    try {
      let res = await brokerApi.connectToAgent(args);
      return res;
    }
    catch (err) {
      console.log(err)
    }
  }

  async createTopic(args) {
  
    try {
      // Get the network (channel) our contract is deployed to.
      let network = await this.gateway.getNetwork(this.channelName);
  
      // Get the contract from the network.
      let contract = network.getContract(this.chaincodeName);
  
      let res = await brokerApi.createTopic(args);
      if(res.Message === `${args.topicNumber} is created`){
        await contract.submitTransaction('createTopic', args.topicNumber, args.topicName);
      }
      return res;
    }
    catch (err) {
      console.log(err);
    }
  }
  
  async queryTopic(args) {
  
    try {
      // Get the network (channel) our contract is deployed to.
      let network = await this.gateway.getNetwork(this.channelName);
  
      // Get the contract from the network.
      let contract = network.getContract(this.chaincodeName);
  
      let topic = await contract.evaluateTransaction('queryTopic', args.topicNumber);
  
      if(topic.toString() !== `${args.topicNumber} does not exist`) {
        topic = await brokerApi.queryTopic(args);
      }
      else {
        topic = {
          Message: topic.toString()
        }
      }
  
      return topic;
    }
    catch (err) {
      console.log(err);
    }
  }
  
  async queryAllTopics() {
  
    try {
      // Get the network (channel) our contract is deployed to.
      let network = await this.gateway.getNetwork(this.channelName);
  
      // Get the contract from the network.
      let contract = network.getContract(this.chaincodeName);
  
      let allTopics = await contract.evaluateTransaction('queryAllTopics');
  
      allTopics = JSON.parse(allTopics);
  
      for (let topic of allTopics) {
  
        let args = {
          topicNumber: topic.Key
        };
  
        topic.Record = await this.queryTopic(args);
      }
  
      return JSON.stringify(allTopics);
    }
    catch (err) {
      console.log(err);
    }
  }
  
  async publishToTopic(args) {
  
    try {
      // Get the network (channel) our contract is deployed to.
      let network = await this.gateway.getNetwork(this.channelName);
  
      // Get the contract from the network.
      let contract = network.getContract(this.chaincodeName);
  
      let topic = await contract.evaluateTransaction('queryTopic', args.topicNumber);
  
      if (topic.toString() !== `${args.topicNumber} does not exist`) {
        topic = await brokerApi.publishToTopic(args);
      }
      else {
        topic = {
          Message: topic.toString()
        }
      }
  
      return topic;
    }
    catch (err) {
      console.log(err);
    }
  }

  async disconnect() {
    await this.gateway.disconnect();
  }
}

module.exports = TopicClient;