/*
The topics chaincode holds the information about the topics that this
publisher can publish to. This chaincode can be thought of as a connector
for interacting with the broker blockchain.
*/

'use strict';

const { Contract } = require('fabric-contract-api');

class Topic extends Contract {

    // Query the state of a topic.
    async queryTopic(ctx, topicNumber) {
      console.info('============= START : Initialize Query Topic ===========');
      const topicAsBytes = await ctx.stub.getState(topicNumber); // get the topic from chaincode state
      if (!topicAsBytes || topicAsBytes.length === 0) {
          return `${topicNumber} does not exist`;
      }
      console.info('============= END : Initialize Query Topic ===========');
      return topicAsBytes.toString();
    }

    // Create a new topic and put it in the ledger.
    async createTopic(ctx, topicNumber, topicName) {
      console.info('============= START : Create Topic ===========');

      const topicAsBytes = await ctx.stub.getState(topicNumber); // get the topic from chaincode state
      if (topicAsBytes && topicAsBytes.length !== 0) {
          return `${topicNumber} already exist`;
      }

      let topic = {
        docType: 'topic',
        topicName
      }
      
      await ctx.stub.putState(topicNumber, Buffer.from(JSON.stringify(topic)));

      console.info('============= END : Create Topic ===========');
    }

    // Query all the topics from the ledger. 
    async queryAllTopics(ctx) {
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
        return JSON.stringify(allResults);
    }
}

module.exports = Topic;
