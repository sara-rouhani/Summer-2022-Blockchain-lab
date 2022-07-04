'use strict';

import express from 'express';
import cors from 'cors';
import { BrokerAgent } from './BrokerAgent';

let agent: BrokerAgent;
let app = express();

app.use(cors())
//support parsing of application/json type post data
app.use(express.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(express.urlencoded({
	extended: false
}));

app.use(express.text());


app.get('/setUp',async function(req,res){
   agent = await BrokerAgent.build()
   res.status(200).send("okay")
})

app.post('/putInvitationlink', async function(req,res){
  // console.log(req.body)
  agent.acceptConnection(req.body)
  res.status(200).send("okay")
})

app.get('/issueCredentials', async function(req,res){
  agent.issueCredential()
  res.status(200).send("okay")
})

app.listen(3004, async function() {
    try {
      console.log("Interface listening");
    }
    catch(error) {
      console.log(`Failed to start interface: ${error}`);
      process.exit(1);
    }
  });