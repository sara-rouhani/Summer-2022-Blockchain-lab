import express, { json, query, urlencoded } from 'express';
import cors from 'cors';

import { Contract, Gateway, Wallets } from 'fabric-network';
import FabricCAServices from 'fabric-ca-client';
import path, { resolve } from 'path';
import { buildCAClient, registerAndEnrollUser, enrollAdmin } from './../../../admin-user-creator/CAUtil';
import { buildCCPOrg1, buildWallet } from '../../../admin-user-creator/AppUtil';
import { BrokerAgent } from './BrokerAgent';
import { Client } from 'fabric-common';
import { greenText, Output } from './OutputClass';

const channelName = 'mychannel';
const chaincodeName = 'broker';
const mspOrg = 'Org1MSP';
const walletPath = path.resolve(__dirname, '..', 'wallet');
const orgUserId = 'appUser';
let wallet: any, ccp: Client | Record<string, unknown>, caClient, contract: Contract, gateway: Gateway, brokerAgent: BrokerAgent;


let setUp = async function () {
  // setup the wallet to hold the credentials of the application user
  wallet = await buildWallet(Wallets, walletPath);

  // build an in memory object with the network configuration (also known as a connection profile)
  ccp = buildCCPOrg1();

  // build an instance of the fabric ca services client based on
  // the information in the network configuration
  caClient = buildCAClient(FabricCAServices, ccp, 'ca.org1.example.com');

  // in a real application this would be done on an administrative flow, and only once
  await enrollAdmin(caClient, wallet, mspOrg);

  // in a real application this would be done only when a new user was required to be added
  // and would be part of an administrative flow
  await registerAndEnrollUser(caClient, wallet, mspOrg, orgUserId, 'org1.department1');

  brokerAgent = await BrokerAgent.build();
}

let connect = async function (req: any, res: any, next: any) {

  gateway = new Gateway();

  try {
    // Create a new gateway for connecting to our peer node.
    await gateway.connect(ccp, { wallet, identity: orgUserId, discovery: { enabled: true, asLocalhost: true } });

    // Get the network (channel) our contract is deployed to.
    const network = await gateway.getNetwork(channelName);

    // Get the contract from the network.
    contract = network.getContract(chaincodeName);

    next();

  }
  catch (error) {
    await gateway.disconnect();
    res.status(500).json({ ErrorMessage: `Unable to connect with broker: ${error}` });
  }
}

let app = express();

app.use(cors())
//support parsing of application/json type post data
app.use(json());
//support parsing of application/x-www-form-urlencoded post data
app.use(urlencoded({
  extended: false
}));

app.use(connect)

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////


app.post('/connectToAgent', async function (req, res) {
  try {
    let { invitation_url, publicDid } = req.body
    let outputMessage, status

    await brokerAgent.acceptConnection(invitation_url)
    let proofResult = await brokerAgent.sendProofRequest("id")
    if (proofResult.isVerified) {
      console.log("Agent verified")
      status = 200
      outputMessage = Output.ConnectionEstablished
    }
    else {
      await brokerAgent.sendMessage("New connection!, issuing credentials..")
      let isAccepted = await brokerAgent.issueCredential(undefined)
      if (isAccepted) {
        status = 200
        outputMessage = Output.ConnectionEstablished + " and Credentials issued!"
        console.log(outputMessage)
      }
      else {
        status = 400
        outputMessage = "please accept credentials"
      }
    }
    brokerAgent.connectionRecordClientId = undefined

    res.status(status).send(outputMessage)

  }
  catch (error) {
    res.status(500).json({ ErrorMessage: `Failed to connect to agent: ${error}` })
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
})


//removes all the credentials from ledger

app.get('/clearAll', async function (req, res) {

  let allRecords = await brokerAgent.agent.credentials.getAll()
  allRecords.forEach(async element => {

    await brokerAgent.agent.credentials.deleteById(element.id)
  });

  console.log(await brokerAgent.agent.credentials.getAll())
  res.status(200).send('Done')

})

app.post('/queryTopic', async function (req, res) {
  try {

    let { topicNumber, clientDid, clientThreadId } = req.body;
    brokerAgent.connectionRecordClientId = (await brokerAgent.agent.connections.findByDid(clientDid))?.id
    await brokerAgent.setCurrCredFromThread(clientThreadId)
    if (brokerAgent.connectionRecordClientId) {

      if (brokerAgent.checkTopics(topicNumber)) {
        let result = await contract.evaluateTransaction('queryTopic', topicNumber);
        res.status(200).json(JSON.parse(result.toString()))
      }
      else {
        throw new Error("The agent is not permitted to query this topic")
      }
    }
    else {
      throw new Error("Please first connect to the broker agent")
    }
    brokerAgent.connectionRecordClientId = undefined
    brokerAgent.currentCredRecord = undefined


  }
  catch (error) {
    res.status(500).json({ ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

app.post('/createTopic', async function (req, res) {
  try {

    let { topicNumber, topicName, publisher, subscribers, message, clientDid, clientThreadId } = req.body;
    let outputMessage, status
    brokerAgent.connectionRecordClientId = (await brokerAgent.agent.connections.findByDid(clientDid))?.id
    brokerAgent.setCurrCredFromThread(clientThreadId)
    if (brokerAgent.connectionRecordClientId) {
      await contract.submitTransaction('createTopic', topicNumber, topicName, publisher, subscribers, message)
      await brokerAgent.sendMessage("Issuing new Credentials...")
      await brokerAgent.issueCredential(topicNumber)
      status = 200
      outputMessage = "Transaction submitted"
    }
    else {
      status = 400
      outputMessage = "Please first connect to the broker agent"
    }
    console.log(brokerAgent.agent.connections.getAll());
    brokerAgent.connectionRecordClientId = undefined
    brokerAgent.currentCredRecord = undefined
    res.status(status).send(outputMessage)
  }
  catch (error) {
    res.status(500).json({ ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    await gateway.disconnect();
  }
});

app.post('/publishToTopic', async function (req, res) {
  try {

    let { topicNumber, message: newMessage, clientDid, clientThreadId } = req.body;
    let outputMessage, status

    brokerAgent.connectionRecordClientId = (await brokerAgent.agent.connections.findByDid(clientDid))?.id
    await brokerAgent.setCurrCredFromThread(clientThreadId)
    if (brokerAgent.connectionRecordClientId) {

      if (brokerAgent.checkTopics(topicNumber)) {
        await contract.submitTransaction('publishToTopic', topicNumber, newMessage);
        status = 200
        outputMessage = "Transaction submitted"
      }
      else {
        status = 400
        outputMessage = "The agent is not permitted to publish to this topic"
      }
    }
    else {
      status = 400
      outputMessage = "Please first connect to the broker agent"
    }
    brokerAgent.connectionRecordClientId = undefined
    brokerAgent.currentCredRecord = undefined
    res.status(status).send(outputMessage)

  }
  catch (error) {
    res.status(500).json({ ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

// Query on chaincode on target peers
app.post('/queryAllTopics', async function (req, res) {
  try {

    let { clientDid, clientThreadId } = req.body;
    brokerAgent.connectionRecordClientId = (await brokerAgent.agent.connections.findByDid(clientDid))?.id
    await brokerAgent.setCurrCredFromThread(clientThreadId)
    if (brokerAgent.connectionRecordClientId) {
      const result = await contract.evaluateTransaction('queryAllTopics');
      res.status(200).json(JSON.parse(result.toString()));
     }
    else {
      throw new Error("Please first connect to the broker agent")
    }
    brokerAgent.connectionRecordClientId = undefined
    brokerAgent.currentCredRecord = undefined
}
  catch (error) {
    res.status(500).json({ ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

app.listen(3000, async function () {
  try {
    await setUp();
    console.log("Broker is listening");
  }
  catch (error) {
    console.log(`Failed to bring up broker: ${error}`);
    process.exit(1);
  }
});