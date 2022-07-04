import type { CredentialExchangeRecord, ProofRecord } from '@aries-framework/core'

import { clear } from 'console'
import fetch from 'node-fetch';
import { textSync } from 'figlet'
import inquirer from 'inquirer'

import { Alice } from './Alice'
import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Listener } from './Listener'
import { greenText, purpleText, redText, Title } from './OutputClass'

const app_url = 'http://localhost:3000/'

export const runAlice = async () => {
  clear()
  console.log(textSync('Alice', { horizontalLayout: 'full' }))
  const alice = await AliceInquirer.build()
  await alice.processAnswer()
}

enum PromptOptions {
  CreateConnection = 'Send connection invitation',
  CreateTopic = 'Create new topic',
  PublishToTopic = "Publish to topic",
  QueryTopic = 'Query topic',
  QuerAllTopics = 'Query all topics',
  SendMessage = 'Send message',
  Exit = 'Exit',
  Restart = 'Restart',
}

export class AliceInquirer extends BaseInquirer {
  public alice: Alice
  public listener: Listener

  public constructor(alice: Alice) {
    super()
    this.alice = alice
    this.listener = new Listener()
    this.listener.messageListener(this.alice.agent, this.alice.name)
  }

  public static async build(): Promise<AliceInquirer> {
    const alice = await Alice.build()

    // let allRecords = await alice.agent.credentials.getAll()
    // allRecords.forEach(async element => {
    //   console.log(element.createdAt)
    //  console.log(element.credentialAttributes)
    // });
    // console.log(await alice.agent.credentials.getAll())
    return new AliceInquirer(alice)
  }

  private async getPromptChoice() {
    if (this.alice.outOfBandId) {
      const connectedOptions = [PromptOptions.CreateTopic, PromptOptions.PublishToTopic,PromptOptions.QueryTopic,PromptOptions.QuerAllTopics,PromptOptions.Exit, PromptOptions.Restart]
      return inquirer.prompt([this.inquireOptions(connectedOptions)])
    }

    const reducedOption = [PromptOptions.CreateConnection, PromptOptions.Exit, PromptOptions.Restart]
    return inquirer.prompt([this.inquireOptions(reducedOption)])
  }

  public async processAnswer() {
    const choice = await this.getPromptChoice()
    if (this.listener.on) return

    switch (choice.options) {
      case PromptOptions.CreateConnection:
        await this.connection()
        break
      case PromptOptions.SendMessage:
        await this.message()
        break
      case PromptOptions.CreateTopic:
        await this.createTopic()
        break
      case PromptOptions.PublishToTopic:
        await this.publishToTopic()
        break
      case PromptOptions.QueryTopic:
        await this.queryTopic()
        break
      case PromptOptions.QuerAllTopics:
        await this.queryAllTopic()
        break
      case PromptOptions.Exit:
        await this.exit()
        break
      case PromptOptions.Restart:
        await this.clearAll()
        return
    }
    await this.processAnswer()
  }


  public async getLatestCred() {
    let allRecords = await this.alice.agent.credentials.getAll()
    let currDate=allRecords[0].createdAt, currThreadId = allRecords[0].threadId 
    allRecords.forEach(async element => {
      if(element.createdAt>currDate){
      currDate = element.createdAt
      currThreadId = element.threadId
      }
    });

    return currThreadId
  }


  public async acceptCredentialOffer(credentialRecord: CredentialExchangeRecord) {
    // const confirm = await inquirer.prompt([this.inquireConfirmation(Title.CredentialOfferTitle)])
    // if (confirm.options === ConfirmOptions.No) {
    //   await this.alice.agent.credentials.declineOffer(credentialRecord.id)
    // } else if (confirm.options === ConfirmOptions.Yes) {
    //   await this.alice.acceptCredentialOffer(credentialRecord)
    // }
    await this.alice.acceptCredentialOffer(credentialRecord)
  }



  public async clearAll() {
    let allRecords = await this.alice.agent.credentials.getAll()
    allRecords.forEach(async element => {
      await this.alice.agent.credentials.deleteById(element.id)
    });
    console.log(allRecords)
  }

  public async getTopicDetails() {
    const topicNumber = (await inquirer.prompt([this.inquireInput(Title.TopicNumberTitle)])).input
    const publisher = (await inquirer.prompt([this.inquireInput(Title.PublisherTitle)])).input
    let subscribers = [];
    subscribers = (await inquirer.prompt([this.inquireInput(Title.SubscribersTitle)])).input
    const message = (await inquirer.prompt([this.inquireInput(Title.MessageDetailsTitle)])).input
    const topicName = (await inquirer.prompt([this.inquireInput(Title.TopicNameTitle)])).input

    return { topicNumber, publisher, subscribers, message, topicName }
  }


  public async sendInvitation(invitation_url: String) {
    let publicDid = this.alice.agent.publicDid?.did
    const reqBody = { invitation_url, publicDid }
    const response = await fetch(app_url + 'connectToAgent', {
      method: 'post',
      body: JSON.stringify(reqBody),
      headers: { 'Content-Type': 'application/json' }
    })

    const data = await response.text();
    if (response.status == 200) {
      this.alice.connected = true
      console.log(greenText(data))
    } else
      console.log(redText(data))

    // console.log(await this.alice.getConnectionRecord())
    // console.log(await this.alice.agent.credentials.getAll())
  }



  public async createTopic() {
    let reqBody = await this.getTopicDetails()
    Object.assign(reqBody, { "clientDid": (await this.alice.getConnectionRecord()).did })
    Object.assign(reqBody,{"clientThreadId":await this.getLatestCred()})
    const response = await fetch(app_url + 'createTopic', {
      method: 'post',
      body: JSON.stringify(reqBody),
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.text();
    if (response.status == 200) {
      console.log(greenText(data))
    } else
      console.log(redText(data))
  }

  public async publishToTopic() {
    const topicNumber = (await inquirer.prompt([this.inquireInput(Title.TopicNumberTitle)])).input
    const message = (await inquirer.prompt([this.inquireInput(Title.MessageDetailsTitle)])).input
    const clientDid = (await this.alice.getConnectionRecord()).did
    const clientThreadId = await this.getLatestCred()
    const reqBody = { topicNumber, message, clientDid, clientThreadId }
    const response = await fetch(app_url + 'publishToTopic', {
      method: 'post',
      body: JSON.stringify(reqBody),
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.text();
    if (response.status == 200) {
      console.log(greenText(data))
    } else
      console.log(redText(data))
  }

  public async queryTopic(){
    const topicNumber = (await inquirer.prompt([this.inquireInput(Title.TopicNumberTitle)])).input
    const clientDid = (await this.alice.getConnectionRecord()).did
    const clientThreadId = await this.getLatestCred()
    const reqBody = { topicNumber, clientDid, clientThreadId }
    const response = await fetch(app_url + 'queryTopic', {
      method: 'post',
      body: JSON.stringify(reqBody),
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json()
    if (response.status == 200) {
      console.log(data)
    } else
      console.log(data)
  }

  public async queryAllTopic(){
    const clientDid = (await this.alice.getConnectionRecord()).did
    const clientThreadId = await this.getLatestCred()
    const reqBody = { clientDid, clientThreadId }
    const response = await fetch(app_url + 'queryAllTopics', {
      method: 'post',
      body: JSON.stringify(reqBody),
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json()
    if (response.status == 200) {
      console.log(data)
    } else
      console.log(data)
    
  }

  public async acceptProofRequest(proofRecord: ProofRecord) {
    // const confirm = await inquirer.prompt([this.inquireConfirmation(Title.ProofRequestTitle)])
    // if (confirm.options === ConfirmOptions.No) {
    //   await this.alice.agent.proofs.declineRequest(proofRecord.id)
    // } else if (confirm.options === ConfirmOptions.Yes) {
    //   await this.alice.acceptProofRequest(proofRecord)
    // }
    console.log(purpleText("Getting verified"))
    await this.alice.acceptProofRequest(proofRecord)
  }

  public async connection() {
    let invitation = await this.alice.setupConnection()
    this.listener.proofRequestListener(this.alice, this)
    this.listener.credentialOfferListener(this.alice, this)
    await this.sendInvitation(invitation)
    // await this.alice.waitForConnection()
  }
























  public async message() {
    const message = await this.inquireMessage()
    if (!message) return

    await this.alice.sendMessage(message)
  }

  public async exit() {
    const confirm = await inquirer.prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.alice.exit()
    }
  }

  public async restart() {
    const confirm = await inquirer.prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.alice.restart()
      await runAlice()
    }
  }
}

void runAlice()
