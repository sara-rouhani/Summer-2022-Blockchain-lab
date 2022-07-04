/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { SubjectMessage } from '../../../../../../tests/transport/SubjectInboundTransport'

import { Subject } from 'rxjs'

import { SubjectInboundTransport } from '../../../../../../tests/transport/SubjectInboundTransport'
import { SubjectOutboundTransport } from '../../../../../../tests/transport/SubjectOutboundTransport'
import { getBaseConfig, waitForBasicMessage } from '../../../../tests/helpers'
import { Agent } from '../../../agent/Agent'
import { sleep } from '../../../utils/sleep'
import { ConnectionRecord, HandshakeProtocol } from '../../connections'
import { MediatorPickupStrategy } from '../MediatorPickupStrategy'
import { MediationState } from '../models/MediationState'

const recipientConfig = getBaseConfig('Mediation: Recipient', {
  indyLedgers: [],
})
const mediatorConfig = getBaseConfig('Mediation: Mediator', {
  autoAcceptMediationRequests: true,
  endpoints: ['rxjs:mediator'],
  indyLedgers: [],
})

const senderConfig = getBaseConfig('Mediation: Sender', {
  endpoints: ['rxjs:sender'],
  indyLedgers: [],
})

describe('mediator establishment', () => {
  let recipientAgent: Agent
  let mediatorAgent: Agent
  let senderAgent: Agent

  afterEach(async () => {
    // We want to stop the mediator polling before the agent is shutdown.
    // FIXME: add a way to stop mediator polling from the public api, and make sure this is
    // being handled in the agent shutdown so we don't get any errors with wallets being closed.
    recipientAgent.config.stop$.next(true)
    await sleep(1000)

    await recipientAgent?.shutdown()
    await recipientAgent?.wallet.delete()
    await mediatorAgent?.shutdown()
    await mediatorAgent?.wallet.delete()
    await senderAgent?.shutdown()
    await senderAgent?.wallet.delete()
  })

  test(`Mediation end-to-end flow
        1. Start mediator agent and create invitation
        2. Start recipient agent with mediatorConnectionsInvite from mediator
        3. Assert mediator and recipient are connected and mediation state is Granted
        4. Start sender agent and create connection with recipient
        5. Assert endpoint in recipient invitation for sender is mediator endpoint
        6. Send basic message from sender to recipient and assert it is received on the recipient side
`, async () => {
    const mediatorMessages = new Subject<SubjectMessage>()
    const recipientMessages = new Subject<SubjectMessage>()
    const senderMessages = new Subject<SubjectMessage>()

    const subjectMap = {
      'rxjs:mediator': mediatorMessages,
      'rxjs:sender': senderMessages,
    }

    // Initialize mediatorReceived message
    mediatorAgent = new Agent(mediatorConfig.config, recipientConfig.agentDependencies)
    mediatorAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    mediatorAgent.registerInboundTransport(new SubjectInboundTransport(mediatorMessages))
    await mediatorAgent.initialize()

    // Create connection to use for recipient
    const mediatorOutOfBandRecord = await mediatorAgent.oob.createInvitation({
      label: 'mediator invitation',
      handshake: true,
      handshakeProtocols: [HandshakeProtocol.DidExchange],
    })

    // Initialize recipient with mediation connections invitation
    recipientAgent = new Agent(
      {
        ...recipientConfig.config,
        mediatorConnectionsInvite: mediatorOutOfBandRecord.outOfBandInvitation.toUrl({
          domain: 'https://example.com/ssi',
        }),
        mediatorPickupStrategy: MediatorPickupStrategy.PickUpV1,
      },
      recipientConfig.agentDependencies
    )
    recipientAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    recipientAgent.registerInboundTransport(new SubjectInboundTransport(recipientMessages))
    await recipientAgent.initialize()

    const recipientMediator = await recipientAgent.mediationRecipient.findDefaultMediator()
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain, @typescript-eslint/no-non-null-assertion
    const recipientMediatorConnection = await recipientAgent.connections.getById(recipientMediator!.connectionId)

    expect(recipientMediatorConnection).toBeInstanceOf(ConnectionRecord)
    expect(recipientMediatorConnection?.isReady).toBe(true)

    const [mediatorRecipientConnection] = await mediatorAgent.connections.findAllByOutOfBandId(
      mediatorOutOfBandRecord.id
    )
    expect(mediatorRecipientConnection!.isReady).toBe(true)

    expect(mediatorRecipientConnection).toBeConnectedWith(recipientMediatorConnection)
    expect(recipientMediatorConnection).toBeConnectedWith(mediatorRecipientConnection!)

    expect(recipientMediator?.state).toBe(MediationState.Granted)

    // Initialize sender agent
    senderAgent = new Agent(senderConfig.config, senderConfig.agentDependencies)
    senderAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    senderAgent.registerInboundTransport(new SubjectInboundTransport(senderMessages))
    await senderAgent.initialize()

    const recipientOutOfBandRecord = await recipientAgent.oob.createInvitation({
      label: 'mediator invitation',
      handshake: true,
      handshakeProtocols: [HandshakeProtocol.Connections],
    })
    const recipientInvitation = recipientOutOfBandRecord.outOfBandInvitation

    let { connectionRecord: senderRecipientConnection } = await senderAgent.oob.receiveInvitationFromUrl(
      recipientInvitation.toUrl({ domain: 'https://example.com/ssi' })
    )

    senderRecipientConnection = await senderAgent.connections.returnWhenIsConnected(senderRecipientConnection!.id)

    let [recipientSenderConnection] = await recipientAgent.connections.findAllByOutOfBandId(recipientOutOfBandRecord.id)
    expect(recipientSenderConnection).toBeConnectedWith(senderRecipientConnection)
    expect(senderRecipientConnection).toBeConnectedWith(recipientSenderConnection!)
    expect(recipientSenderConnection!.isReady).toBe(true)
    expect(senderRecipientConnection.isReady).toBe(true)

    recipientSenderConnection = await recipientAgent.connections.returnWhenIsConnected(recipientSenderConnection!.id)

    const message = 'hello, world'
    await senderAgent.basicMessages.sendMessage(senderRecipientConnection.id, message)

    const basicMessage = await waitForBasicMessage(recipientAgent, {
      content: message,
    })

    expect(basicMessage.content).toBe(message)
  })

  test('restart recipient agent and create connection through mediator after recipient agent is restarted', async () => {
    const mediatorMessages = new Subject<SubjectMessage>()
    const recipientMessages = new Subject<SubjectMessage>()
    const senderMessages = new Subject<SubjectMessage>()

    const subjectMap = {
      'rxjs:mediator': mediatorMessages,
      'rxjs:sender': senderMessages,
    }

    // Initialize mediator
    mediatorAgent = new Agent(mediatorConfig.config, recipientConfig.agentDependencies)
    mediatorAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    mediatorAgent.registerInboundTransport(new SubjectInboundTransport(mediatorMessages))
    await mediatorAgent.initialize()

    // Create connection to use for recipient
    const mediatorOutOfBandRecord = await mediatorAgent.oob.createInvitation({
      label: 'mediator invitation',
      handshake: true,
      handshakeProtocols: [HandshakeProtocol.Connections],
    })

    // Initialize recipient with mediation connections invitation
    recipientAgent = new Agent(
      {
        ...recipientConfig.config,
        mediatorConnectionsInvite: mediatorOutOfBandRecord.outOfBandInvitation.toUrl({
          domain: 'https://example.com/ssi',
        }),
        mediatorPickupStrategy: MediatorPickupStrategy.PickUpV1,
      },
      recipientConfig.agentDependencies
    )
    recipientAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    recipientAgent.registerInboundTransport(new SubjectInboundTransport(recipientMessages))
    await recipientAgent.initialize()

    const recipientMediator = await recipientAgent.mediationRecipient.findDefaultMediator()
    const recipientMediatorConnection = await recipientAgent.connections.getById(recipientMediator!.connectionId)
    expect(recipientMediatorConnection?.isReady).toBe(true)

    const [mediatorRecipientConnection] = await mediatorAgent.connections.findAllByOutOfBandId(
      mediatorOutOfBandRecord.id
    )
    expect(mediatorRecipientConnection!.isReady).toBe(true)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(mediatorRecipientConnection).toBeConnectedWith(recipientMediatorConnection!)
    expect(recipientMediatorConnection).toBeConnectedWith(mediatorRecipientConnection!)

    expect(recipientMediator?.state).toBe(MediationState.Granted)

    // Restart recipient agent
    await recipientAgent.shutdown()
    recipientAgent = new Agent(
      {
        ...recipientConfig.config,
        mediatorConnectionsInvite: mediatorOutOfBandRecord.outOfBandInvitation.toUrl({
          domain: 'https://example.com/ssi',
        }),
        mediatorPickupStrategy: MediatorPickupStrategy.PickUpV1,
      },
      recipientConfig.agentDependencies
    )
    recipientAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    recipientAgent.registerInboundTransport(new SubjectInboundTransport(recipientMessages))
    await recipientAgent.initialize()

    // Initialize sender agent
    senderAgent = new Agent(senderConfig.config, senderConfig.agentDependencies)
    senderAgent.registerOutboundTransport(new SubjectOutboundTransport(subjectMap))
    senderAgent.registerInboundTransport(new SubjectInboundTransport(senderMessages))
    await senderAgent.initialize()

    const recipientOutOfBandRecord = await recipientAgent.oob.createInvitation({
      label: 'mediator invitation',
      handshake: true,
      handshakeProtocols: [HandshakeProtocol.Connections],
    })
    const recipientInvitation = recipientOutOfBandRecord.outOfBandInvitation

    let { connectionRecord: senderRecipientConnection } = await senderAgent.oob.receiveInvitationFromUrl(
      recipientInvitation.toUrl({ domain: 'https://example.com/ssi' })
    )

    senderRecipientConnection = await senderAgent.connections.returnWhenIsConnected(senderRecipientConnection!.id)
    const [recipientSenderConnection] = await recipientAgent.connections.findAllByOutOfBandId(
      recipientOutOfBandRecord.id
    )
    expect(recipientSenderConnection).toBeConnectedWith(senderRecipientConnection)
    expect(senderRecipientConnection).toBeConnectedWith(recipientSenderConnection!)

    expect(recipientSenderConnection!.isReady).toBe(true)
    expect(senderRecipientConnection.isReady).toBe(true)

    const message = 'hello, world'
    await senderAgent.basicMessages.sendMessage(senderRecipientConnection.id, message)

    const basicMessage = await waitForBasicMessage(recipientAgent, {
      content: message,
    })

    expect(basicMessage.content).toBe(message)
  })
})
