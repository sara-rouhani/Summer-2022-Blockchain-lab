import type { AgentConfig } from '../../../agent/AgentConfig'
import type { StorageService } from '../../../storage/StorageService'
import type { BasicMessageStateChangedEvent } from '../BasicMessageEvents'

import { getAgentConfig, getMockConnection } from '../../../../tests/helpers'
import { EventEmitter } from '../../../agent/EventEmitter'
import { InboundMessageContext } from '../../../agent/models/InboundMessageContext'
import { IndyStorageService } from '../../../storage/IndyStorageService'
import { Repository } from '../../../storage/Repository'
import { IndyWallet } from '../../../wallet/IndyWallet'
import { BasicMessageEventTypes } from '../BasicMessageEvents'
import { BasicMessageRole } from '../BasicMessageRole'
import { BasicMessage } from '../messages'
import { BasicMessageRecord } from '../repository/BasicMessageRecord'
import { BasicMessageService } from '../services'

describe('BasicMessageService', () => {
  const mockConnectionRecord = getMockConnection({
    id: 'd3849ac3-c981-455b-a1aa-a10bea6cead8',
    did: 'did:sov:C2SsBf5QUQpqSAQfhu3sd2',
  })

  let wallet: IndyWallet
  let storageService: StorageService<BasicMessageRecord>
  let agentConfig: AgentConfig

  beforeAll(async () => {
    agentConfig = getAgentConfig('BasicMessageServiceTest')
    wallet = new IndyWallet(agentConfig)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await wallet.createAndOpen(agentConfig.walletConfig!)
    storageService = new IndyStorageService(wallet, agentConfig)
  })

  afterAll(async () => {
    await wallet.delete()
  })

  describe('save', () => {
    let basicMessageRepository: Repository<BasicMessageRecord>
    let basicMessageService: BasicMessageService
    let eventEmitter: EventEmitter

    beforeEach(() => {
      eventEmitter = new EventEmitter(agentConfig)
      basicMessageRepository = new Repository<BasicMessageRecord>(BasicMessageRecord, storageService, eventEmitter)
      basicMessageService = new BasicMessageService(basicMessageRepository, eventEmitter)
    })

    it(`emits newMessage with message and basic message record`, async () => {
      const eventListenerMock = jest.fn()
      eventEmitter.on<BasicMessageStateChangedEvent>(BasicMessageEventTypes.BasicMessageStateChanged, eventListenerMock)

      const basicMessage = new BasicMessage({
        id: '123',
        content: 'message',
      })

      const messageContext = new InboundMessageContext(basicMessage)

      await basicMessageService.save(messageContext, mockConnectionRecord)

      expect(eventListenerMock).toHaveBeenCalledWith({
        type: 'BasicMessageStateChanged',
        payload: {
          basicMessageRecord: expect.objectContaining({
            connectionId: mockConnectionRecord.id,
            id: expect.any(String),
            sentTime: basicMessage.sentTime.toISOString(),
            content: basicMessage.content,
            role: BasicMessageRole.Receiver,
          }),
          message: messageContext.message,
        },
      })
    })
  })
})
