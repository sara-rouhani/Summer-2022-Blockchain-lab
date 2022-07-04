import { inject, scoped, Lifecycle } from 'tsyringe'

import { EventEmitter } from '../../../agent/EventEmitter'
import { InjectionSymbols } from '../../../constants'
import { Repository } from '../../../storage/Repository'
import { StorageService } from '../../../storage/StorageService'

import { CredentialExchangeRecord } from './CredentialExchangeRecord'

@scoped(Lifecycle.ContainerScoped)
export class CredentialRepository extends Repository<CredentialExchangeRecord> {
  public constructor(
    @inject(InjectionSymbols.StorageService) storageService: StorageService<CredentialExchangeRecord>,
    eventEmitter: EventEmitter
  ) {
    super(CredentialExchangeRecord, storageService, eventEmitter)
  }
}
