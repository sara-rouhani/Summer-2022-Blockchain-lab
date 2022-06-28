'use strict';

const express = require('express');
const cors = require('cors');

const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../admin-user-creator/CAUtil.js');
const { buildCCPOrg1, buildWallet } = require('../../admin-user-creator/AppUtil.js');

const channelName = 'mychannel';
const chaincodeName = 'broker';
const mspOrg = 'Org1MSP';
const walletPath = path.join(__dirname, 'wallet');
const orgUserId = 'appUser';
let wallet, ccp, caClient, contract, gateway;

let setUp = async function() {
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
}

let connect = async function(req, res, next) {

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
    res.status(500).json({ErrorMessage: `Unable to connect with broker: ${error}` });
  } 
}

let app = express();

app.use(cors())
//support parsing of application/json type post data
app.use(express.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(express.urlencoded({
	extended: false
}));

app.use(connect)

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////

app.post('/queryTopic', async function (req, res) {
  try {
    
    let {topicNumber} = req.body;

    let result = await contract.evaluateTransaction('queryTopic', topicNumber);
    res.status(200).json(JSON.parse(result.toString()));

  }
  catch (error) {
      res.status(500).json({ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

app.post('/createTopic', async function (req, res) {
  try {

    let {topicNumber, topicName, publisher, subscribers, message} = req.body;

    let result = await contract.submitTransaction('createTopic', topicNumber, topicName, publisher, subscribers, message);
    res.status(200).json(JSON.parse(result.toString()));

  }
  catch (error) {
    res.status(500).json({ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

app.post('/publishToTopic', async function (req, res) {
  try {

    let {topicNumber, message: newMessage} = req.body;

    let result = await contract.submitTransaction('publishToTopic', topicNumber, newMessage);
    res.status(200).json(JSON.parse(result.toString()));

  }
  catch (error) {
    res.status(500).json({ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

// Query on chaincode on target peers
app.get('/queryAllTopics', async function(req, res) {
	try {

    const result = await contract.evaluateTransaction('queryAllTopics');
    res.status(200).json(JSON.parse(result.toString()));

  }
  catch (error) {
    res.status(500).json({ErrorMessage: `Failed to submit transaction: ${error}` });
  }
  finally {
    // Disconnect from the gateway.
    await gateway.disconnect();
  }
});

app.listen(3000, async function() {
  try {
    await setUp();
    console.log("Broker is listening");
  }
  catch(error) {
    console.log(`Failed to bring up broker: ${error}`);
    process.exit(1);
  }
});