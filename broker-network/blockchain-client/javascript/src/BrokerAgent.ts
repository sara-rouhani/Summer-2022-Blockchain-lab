import { AttributeValue, ConnectionEventTypes, ConnectionRecord, ConnectionStateChangedEvent, CredentialEventTypes, CredentialExchangeRecord, CredentialState, CredentialStateChangedEvent, ProofEventTypes, ProofIdentifier, ProofRecord, ProofState, ProofStateChangedEvent, V1CredentialService, V2CredentialPreview, V2CredentialService } from '@aries-framework/core'
import type { CredDef, Schema } from 'indy-sdk'

import { V1CredentialPreview, AttributeFilter, ProofAttributeInfo, utils } from '@aries-framework/core'

import { BaseAgent } from './BaseAgent'
import { Color, greenText, Output, purpleText, redText } from './OutputClass'


export class BrokerAgent extends BaseAgent {
  public connectionRecordClientId?: string
  public credentialDefinition?: CredDef
  public currentCredRecord?: CredentialExchangeRecord
  public constructor(port: number, name: string) {
    super(port, name)
  }

  public static async build(): Promise<BrokerAgent> {
    const broker = new BrokerAgent(9003, 'broker')
    await broker.initializeAgent()
    return broker
  }

  private async getConnectionRecord() {
    if (!this.connectionRecordClientId) {
      throw Error(redText(Output.MissingConnectionRecord))
    }
    return await this.agent.connections.getById(this.connectionRecordClientId)
  }


  private async receiveConnectionRequest(invitationUrl: string) {
    const { connectionRecord } = await this.agent.oob.receiveInvitationFromUrl(invitationUrl)
    if (!connectionRecord) {
      throw new Error(redText(Output.NoConnectionRecordFromOutOfBand))
    }
    return connectionRecord
  }

  private async waitForConnection(connectionRecord: ConnectionRecord) {
    connectionRecord = await this.agent.connections.returnWhenIsConnected(connectionRecord.id)
    console.log(greenText(Output.ConnectionEstablished))
    return connectionRecord.id
  }

  public async acceptConnection(invitation_url: string) {
    const connectionRecord = await this.receiveConnectionRequest(invitation_url)
    this.connectionRecordClientId = await this.waitForConnection(connectionRecord)
  }

  private printSchema(name: string, version: string, attributes: string[]) {
    console.log(`\n\nThe credential definition will look like this:\n`)
    console.log(purpleText(`Name: ${Color.Reset}${name}`))
    console.log(purpleText(`Version: ${Color.Reset}${version}`))
    console.log(purpleText(`Attributes: ${Color.Reset}${attributes[0]}, ${attributes[1]}\n`))
  }

  private async registerSchema() {
    const schemaTemplate = {
      name: 'BrokerAgent' + utils.uuid(),
      version: '1.0.0',
      attributes: ['id', 'topics'],
    }
    this.printSchema(schemaTemplate.name, schemaTemplate.version, schemaTemplate.attributes)
    const schema = await this.agent.ledger.registerSchema(schemaTemplate)
    return schema
  }


  private async registerCredentialDefinition(schema: Schema) {
    this.credentialDefinition = await this.agent.ledger.registerCredentialDefinition({
      schema,
      tag: 'latest',
      supportRevocation: false,
    })
    return this.credentialDefinition
  }

  private getCredentialPreview(newTopic?: string) {
    let currId,currTopics
    if(this.currentCredRecord?.credentialAttributes && newTopic){
      // console.log("working")
      currId = this.currentCredRecord.credentialAttributes[0].value
      // currName =  this.currentCredRecord.credentialAttributes[1].value
      if(this.currentCredRecord.credentialAttributes[1].value !== "")
      currTopics = this.currentCredRecord.credentialAttributes[1].value+", "+newTopic
      else
      currTopics = newTopic
    }
    else{
      currId = utils.uuid()
      // currName = 'Publisher 1'
      currTopics = ''
    }
  
  const credentialPreview = V1CredentialPreview.fromRecord({
    
    id: currId,
    // name: currName,
    topics: currTopics
  })
    return credentialPreview
  }

  public async issueCredential(newTopic?: string) {
    const schema = await this.registerSchema()
    const credDef = await this.registerCredentialDefinition(schema)
    const credentialPreview = this.getCredentialPreview(newTopic)
    const connectionRecord = await this.getConnectionRecord()

    await this.agent.credentials.offerCredential({
    
      connectionId: connectionRecord.id,
      protocolVersion: 'v1',
      credentialFormats: {
        indy: {
          attributes : credentialPreview.attributes,
          credentialDefinitionId: credDef.id,
        },
      },
    })

   return await this.credentialAcceptedListener()
  }

  private async printProofFlow(print: string) {
    console.log(print)
    await new Promise((f) => setTimeout(f, 2000))
  }

  private async newProofAttribute(attributeName : string) {
    // let currTopics
    // if(this.currentCredRecord?.credentialAttributes)
    // currTopics = this.currentCredRecord?.credentialAttributes[1].value
    await this.printProofFlow(greenText(`Creating new proof attribute for `+attributeName+` ...\n`))
    const proofAttribute = {
      attribute: new ProofAttributeInfo({
        name: attributeName,
        restrictions: [
          new AttributeFilter({
            credentialDefinitionId: this.credentialDefinition?.id,
            // attributeValue: this.currentCredRecord?new AttributeValue({name: "topics",value: currTopics?currTopics: ""}):undefined
          }),
        ],
      }),
    }
    return proofAttribute
  }


  public async sendProofRequest(attributeName: string) {
    const connectionRecord = await this.getConnectionRecord()
    const proofAttribute = await this.newProofAttribute(attributeName)
    console.log(greenText('\nRequesting proof...\n', false))
    let proofRecord = await this.agent.proofs.requestProof(connectionRecord.id, {
      requestedAttributes: proofAttribute,
    })
    
    return await this.proofAcceptedListener(proofRecord)
    }

  public async proofAcceptedListener(proofRecord : ProofRecord) {

    const getProofRecord = () =>
    new Promise<ProofRecord>((resolve,reject) => {
      console.log(greenText("Waiting for proof to be accepted"))
      const timeoutId =  setTimeout(() => resolve(proofRecord),6000)
      this.agent.events.on<ProofStateChangedEvent>(ProofEventTypes.ProofStateChanged, (e) => {
        if (e.payload.proofRecord.state == ProofState.Done && e.payload.proofRecord.connectionId === this.connectionRecordClientId) return
        clearTimeout(timeoutId)
        resolve(e.payload.proofRecord)
      })
    })    
    return await getProofRecord()
  }

  public async credentialAcceptedListener() {
    let credAccepted  = false 
    const getCredentialRecord = () =>
    new Promise<CredentialExchangeRecord>((resolve, reject) => {
      console.log(greenText("Waiting for credentials to be accepted"))
      // Timeout of 20 seconds
      const timeoutId = setTimeout(() => reject(new Error(redText("No credential record set"))), 200000)

      // Start listener
      this.agent.events.on<CredentialStateChangedEvent>(CredentialEventTypes.CredentialStateChanged, (e) => {
        if (e.payload.credentialRecord.state == CredentialState.Done && e.payload.credentialRecord.connectionId === this.connectionRecordClientId) return
        credAccepted = true
        clearTimeout(timeoutId)
        resolve(e.payload.credentialRecord)
      })

      // Also retrieve the connection record by invitation if the event has already fired
      // void this.agent.connections.findAllByOutOfBandId(outOfBandId).then(([connectionRecord]) => {
      //   if (connectionRecord) {
      //     clearTimeout(timeoutId)
      //     resolve(connectionRecord)
      //   }
      // })
      
    })

    let credRecord = await getCredentialRecord()
    if(credAccepted){
    this.currentCredRecord = credRecord
    console.log("credentials accepted")
    }

    return credAccepted
  }

  public checkTopics(checkTopic:string){
    let flag = false
    if(this.currentCredRecord?.credentialAttributes){
      if(this.currentCredRecord?.credentialAttributes[1].value.includes(checkTopic))
      flag = true
  }
  return flag
  }

  public async setCurrCredFromThread(threadId:string){
    let allRecords = await this.agent.credentials.getAll()
    allRecords.forEach(async element => {
      if(element.threadId == threadId){
        return this.currentCredRecord = element
      }
    });
  }

  public async sendMessage(message: string) {
    const connectionRecord = await this.getConnectionRecord()
    await this.agent.basicMessages.sendMessage(connectionRecord.id, message)
  }

  public async exit() {
    console.log(Output.Exit)
    await this.agent.shutdown()
    process.exit(0)
  }

  public async restart() {
    await this.agent.shutdown()
  }
}
