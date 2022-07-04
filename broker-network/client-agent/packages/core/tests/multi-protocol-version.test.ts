import type { SubjectMessage } from '../../../tests/transport/SubjectInboundTransport'
import type { AgentMessageProcessedEvent } from '../src/agent/Events'

import { filter, firstValueFrom, Subject, timeout } from 'rxjs'

import { SubjectInboundTransport } from '../../../tests/transport/SubjectInboundTransport'
import { SubjectOutboundTransport } from '../../../tests/transport/SubjectOutboundTransport'
import { parseMessageType, MessageSender, Dispatcher, AgentMessage, IsValidMessageType } from '../src'
import { Agent } from '../src/agent/Agent'
import { AgentEventTypes } from '../src/agent/Events'
import { createOutboundMessage } from '../src/agent/helpers'

import { getBaseConfig } from './helpers'

const aliceConfig = getBaseConfig('Multi Protocol Versions - Alice', {
  endpoints: ['rxjs:alice'],
})
const bobConfig = getBaseConfig('Multi Protocol Versions - Bob', {
  endpoints: ['rxjs:bob'],
})

describe('multi version protocols', () => {
  let aliceAgent: Agent
  let bobAgent: Agent

  afterAll(async () => {
    await bobAgent.shutdown()
    await bobAgent.wallet.delete()
    await aliceAgent.shutdown()
    await aliceAgent.wallet.delete()
  })

  test('should successfully handle a message with a lower minor version than the currently supported version', async () => {
    const aliceMessages = new Subject<SubjectMessage>()
    const bobMessages = new Subject<SubjectMessage>()

    const subjectMap = {
      'rxjs:alice': aliceMessages,
      'rxjs:bob': bobMessages,
    }

    const mockHandle = jest.fn()

    aliceAgent = new Agent(aliceConfig.config, aliceConfig.agentDependencies)
    aliceAgent.registerInboundTransport(new SubjectInboundTransport(aliceMessages))
    aliceAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))

    // Register the test handler with the v1.3 version of the message
    const dispatcher = aliceAgent.injectionContainer.resolve(Dispatcher)
    dispatcher.registerHandler({ supportedMessages: [TestMessageV13], handle: mockHandle })

    await aliceAgent.initialize()

    bobAgent = new Agent(bobConfig.config, bobConfig.agentDependencies)
    bobAgent.registerInboundTransport(new SubjectInboundTransport(bobMessages))
    bobAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    await bobAgent.initialize()

    const { outOfBandInvitation, id } = await aliceAgent.oob.createInvitation()
    let { connectionRecord: bobConnection } = await bobAgent.oob.receiveInvitation(outOfBandInvitation, {
      autoAcceptConnection: true,
      autoAcceptInvitation: true,
    })

    if (!bobConnection) {
      throw new Error('No connection for bob')
    }

    bobConnection = await bobAgent.connections.returnWhenIsConnected(bobConnection.id)

    let [aliceConnection] = await aliceAgent.connections.findAllByOutOfBandId(id)
    aliceConnection = await aliceAgent.connections.returnWhenIsConnected(aliceConnection.id)

    expect(aliceConnection).toBeConnectedWith(bobConnection)
    expect(bobConnection).toBeConnectedWith(aliceConnection)

    const bobMessageSender = bobAgent.injectionContainer.resolve(MessageSender)

    // Start event listener for message processed
    const agentMessageV11ProcessedPromise = firstValueFrom(
      aliceAgent.events.observable<AgentMessageProcessedEvent>(AgentEventTypes.AgentMessageProcessed).pipe(
        filter((event) => event.payload.message.type === TestMessageV11.type.messageTypeUri),
        timeout(8000)
      )
    )

    await bobMessageSender.sendMessage(createOutboundMessage(bobConnection, new TestMessageV11()))

    // Wait for the agent message processed event to be called
    await agentMessageV11ProcessedPromise

    expect(mockHandle).toHaveBeenCalledTimes(1)

    // Start event listener for message processed
    const agentMessageV15ProcessedPromise = firstValueFrom(
      aliceAgent.events.observable<AgentMessageProcessedEvent>(AgentEventTypes.AgentMessageProcessed).pipe(
        filter((event) => event.payload.message.type === TestMessageV15.type.messageTypeUri),
        timeout(8000)
      )
    )

    await bobMessageSender.sendMessage(createOutboundMessage(bobConnection, new TestMessageV15()))
    await agentMessageV15ProcessedPromise

    expect(mockHandle).toHaveBeenCalledTimes(2)
  })
})

class TestMessageV11 extends AgentMessage {
  public constructor() {
    super()
    this.id = this.generateId()
  }

  @IsValidMessageType(TestMessageV11.type)
  public readonly type = TestMessageV11.type.messageTypeUri
  public static readonly type = parseMessageType('https://didcomm.org/custom-protocol/1.1/test-message')
}

class TestMessageV13 extends AgentMessage {
  public constructor() {
    super()
    this.id = this.generateId()
  }

  @IsValidMessageType(TestMessageV13.type)
  public readonly type = TestMessageV13.type.messageTypeUri
  public static readonly type = parseMessageType('https://didcomm.org/custom-protocol/1.3/test-message')
}

class TestMessageV15 extends AgentMessage {
  public constructor() {
    super()
    this.id = this.generateId()
  }

  @IsValidMessageType(TestMessageV15.type)
  public readonly type = TestMessageV15.type.messageTypeUri
  public static readonly type = parseMessageType('https://didcomm.org/custom-protocol/1.5/test-message')
}
