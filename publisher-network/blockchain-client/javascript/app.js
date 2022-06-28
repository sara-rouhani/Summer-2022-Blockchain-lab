/*
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

let TopicClient = require('./client-app/TopicClient');

async function main() {

  try {
    console.log('============= START: Client Connecting Configuration ===========');

      let connectConfig = {
        mspOrg: 'Org1MSP',
        orgUserId: 'appUser',
        caClientPath: 'ca.org1.example.com',
        userPath: 'org1.department1'
      }

    let client = new TopicClient();
    await client.initConnection(connectConfig);
      
    console.log('============= END: Client Connecting Configuration ===========');

    console.log('============= START : Create Topic ===========');

    let args = {
      topicNumber: 'TOPIC0',
      topicName: 'test topic 0',
      publisher: 'test publisher 0',
      subscribers: ['test sub 0','test sub 1'],
      message: 'this is a test message 0'
    };

    await client.createTopic(args);

    args = {
      topicNumber: 'TOPIC1',
      topicName: 'test topic 1',
      publisher: 'test publisher 1',
      subscribers: ['test sub 2','test sub 3'],
      message: 'this is a test message 1'
    };

    await client.createTopic(args);

    args = {
      topicNumber: 'TOPIC2',
      topicName: 'test topic 2',
      publisher: 'test publisher 2',
      subscribers: ['test sub 2','test sub 2'],
      message: 'this is a test message 2'
    };

    await client.createTopic(args);

    console.log('============= END : Create Topic ===========');

    console.log('============= START : Query All Topics ===========');

    let result = await client.queryAllTopics();
    console.log(JSON.parse(result));

    console.log('============= END : Query All Topics ===========');

    console.log('============= START : Query Specific Topic ===========');
    args = {
      topicNumber: 'TOPIC1'
    };

    result = await client.queryTopic(args);
    console.log(result);

    console.log('============= END : Query Specific Topic ===========');

    console.log('============= START : Publish To Topic ===========');

    args = {
      topicNumber: 'TOPIC3',
      message: 'I just change message 3'
    };

    result = await client.publishToTopic(args);
    console.log(result);

    console.log('============= END : Publish To Topic ===========');

    client.disconnect();

  }
  catch (error) {
    console.error(`******** FAILED to run the application: ${error}`);
  }
}

main();
