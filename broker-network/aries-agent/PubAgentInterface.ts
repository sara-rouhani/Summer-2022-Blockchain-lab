
import express from 'express';
import cors from 'cors';
import { PubAgent } from './PubAgent';


let app = express();

app.use(cors())
//support parsing of application/json type post data
app.use(express.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(express.urlencoded({
	extended: false
}));


app.get('/setUp',async function(req,res){

  let agent = await PubAgent.build()
  agent.setupConnection()
  res.status(200).send("okay")

})

app.listen(3003, async function() {
    try {
      console.log("Interface listening");
    }
    catch(error) {
      console.log(`Failed to start interface: ${error}`);
      process.exit(1);
    }
  });