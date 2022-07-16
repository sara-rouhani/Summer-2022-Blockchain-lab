import type { CredentialExchangeRecord, ProofRecord } from '@aries-framework/core'

import { clear } from 'console'
import fetch from 'node-fetch';
import { textSync } from 'figlet'
import inquirer from 'inquirer'

import { ClientAgent } from './ClientAgent'
import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Listener } from './Listener'
import { greenText, purpleText, redText, Title } from './OutputClass'

import TopicClient from '../client-app/TopicClient';

const app_url = 'http://localhost:3000/'

export const runClientAgent = async () => {
  clear()
  console.log(textSync('ClientAgent', { horizontalLayout: 'full' }))
  const clientAgent = await ClientInquirer.build()
  await clientAgent.processAnswer()
}

enum PromptOptions {
  CreateConnection = 'Send connection invitation',
  CreateTopic = 'Create new topic',
  PublishToTopic = "Publish to topic",
  QueryTopic = 'Query topic',
  QuerAllTopics = 'Query all topics',
  SendMessage = 'Send message',
  Exit = 'Exit',
  Restart = 'clear all credentials from ledger',
}

export class ClientInquirer extends BaseInquirer {
  public clientAgent: ClientAgent
  public listener: Listener
  public clientApi: TopicClient

  public constructor(clientAgent: ClientAgent, clientApi: TopicClient) {
    super()
    this.clientAgent = clientAgent
    this.clientApi = clientApi
    this.listener = new Listener()
    this.listener.messageListener(this.clientAgent.agent, this.clientAgent.name)
  }

  public static async build(): Promise<ClientInquirer> {
    const clientAgent = await ClientAgent.build()

    let connectConfig = {
      mspOrg: 'Org1MSP',
      orgUserId: 'appUser',
      caClientPath: 'ca.org1.example.com',
      userPath: 'org1.department1'
    }

    const clientApi = await TopicClient.build(connectConfig)
    return new ClientInquirer(clientAgent, clientApi)
  }

  private async getPromptChoice() {
    if (this.clientAgent.outOfBandId) {
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
        break
    }
    await this.processAnswer()
  }

  public async getLatestCred() {
    let allRecords = await this.clientAgent.agent.credentials.getAll()
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
    await this.clientAgent.acceptCredentialOffer(credentialRecord)
  }

  public async clearAll() {
    let allRecords = await this.clientAgent.agent.credentials.getAll()
    allRecords.forEach(async element => {
      await this.clientAgent.agent.credentials.deleteById(element.id)
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
    // let publicDid = this.clientAgent.agent.publicDid?.did
    const reqBody = { invitation_url }
    // const response = await fetch(app_url + 'connectToAgent', {
    //   method: 'post',
    //   body: JSON.stringify(reqBody),
    //   headers: { 'Content-Type': 'application/json' }
    // })
    const response = await this.clientApi.connectToAgent(reqBody);

    const data = await response.text();
    console.log(data);
    // if (response.status == 200) {
    //   this.clientAgent.connected = true
    //   console.log(greenText(data))
    // } else
    //   console.log(redText(data))
  }

  public async createTopic() {
    let reqBody = await this.getTopicDetails()
    Object.assign(reqBody, { "clientDid": (await this.clientAgent.getConnectionRecord()).did })
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

      console.log(await this.clientAgent.agent.connections.getAll());
  }

  public async publishToTopic() {
    const topicNumber = (await inquirer.prompt([this.inquireInput(Title.TopicNumberTitle)])).input
    const message = (await inquirer.prompt([this.inquireInput(Title.MessageDetailsTitle)])).input
    const clientDid = (await this.clientAgent.getConnectionRecord()).did
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
    const clientDid = (await this.clientAgent.getConnectionRecord()).did
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
    const clientDid = (await this.clientAgent.getConnectionRecord()).did
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
    console.log(purpleText("Getting verified"))
    await this.clientAgent.acceptProofRequest(proofRecord)
  }

  public async connection() {
    let invitation = await this.clientAgent.setupConnection()
    this.listener.proofRequestListener(this.clientAgent, this)
    this.listener.credentialOfferListener(this.clientAgent, this)
    await this.sendInvitation(invitation)
  }

  public async message() {
    const message = await this.inquireMessage()
    if (!message) return

    await this.clientAgent.sendMessage(message)
  }

  public async exit() {
    const confirm = await inquirer.prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.clientAgent.exit()
    }
  }

  public async restart() {
    const confirm = await inquirer.prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.clientAgent.restart()
      await runClientAgent()
    }
  }
}

void runClientAgent()
