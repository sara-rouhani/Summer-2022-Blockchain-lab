'use strict';

const { Contract } = require('fabric-contract-api');

class Broker extends Contract {

  // Query the state of a topic from the ledger.
  async queryTopic(ctx, topicNumber) {
      console.info('============= START : Initialize Query Topic ===========');
      const topicAsBytes = await ctx.stub.getState(topicNumber); // get the topic from chaincode state
      if (!topicAsBytes || topicAsBytes.length === 0) {
          return {Message: `${topicNumber} does not exist`};
      }
      console.info('============= END : Initialize Query Topic ===========');
      return topicAsBytes.toString();
  }

  // Create a new topic with the provided information and put it on the ledger.
  async createTopic(ctx, topicNumber, topicName, publisher, subscribers, message) {
      console.info('============= START : Create Topic ===========');

      const topicAsBytes = await ctx.stub.getState(topicNumber); // get the topic from chaincode state
      if (topicAsBytes && topicAsBytes.length !== 0) {
          return {Message: `${topicNumber} already exist`};
      }

      let subscribersArr = subscribers.split(',');
      let topic = {
        docType: 'topic',
        topicName,
        publisher,
        subscribers: subscribersArr,
        message
      }
      
      await ctx.stub.putState(topicNumber, Buffer.from(JSON.stringify(topic)));
      console.info('============= END : Create Topic ===========');
      return {Message: `${topicNumber} is created`};
  }

  // Publish to a topic by updating the message and notifying all subscribers.
  async publishToTopic(ctx, topicNumber, newMessage) {
    console.info('============= START : Publish to a Topic ===========');

    const topicAsBytes = await ctx.stub.getState(topicNumber); // get the topic from chaincode state
    if (!topicAsBytes || topicAsBytes.length === 0) {
        return {Message: `${topicNumber} does not exist`};
    }
    const topic = JSON.parse(topicAsBytes.toString());
    topic.message = newMessage;

    await ctx.stub.putState(topicNumber, Buffer.from(JSON.stringify(topic))); // update topic message on ledger
    
    console.info('============= END : Publish to a Topic ===========');
    return {Message: `${topicNumber} is updated`};
  }

  // Query all topics from the ledger.
  async queryAllTopics(ctx) {
      console.info('============= START : Initialize Query All Topics ===========');
      const startKey = '';
      const endKey = '';
      const allResults = [];
      for await (const {key, value} of ctx.stub.getStateByRange(startKey, endKey)) {
          const strValue = Buffer.from(value).toString('utf8');
          let record;
          try {
              record = JSON.parse(strValue);
          } catch (err) {
              console.log(err);
              record = strValue;
          }
          allResults.push({ Key: key, Record: record });
      }
      console.info(allResults);
      console.info('============= END : Initialize Query All Topics ===========');
      return allResults;
  }
}

module.exports = Broker;