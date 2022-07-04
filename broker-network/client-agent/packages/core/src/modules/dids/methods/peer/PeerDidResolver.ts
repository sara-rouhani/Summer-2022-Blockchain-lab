import type { DidDocument } from '../../domain'
import type { DidResolver } from '../../domain/DidResolver'
import type { DidRepository } from '../../repository'
import type { DidResolutionResult } from '../../types'

import { AriesFrameworkError } from '../../../../error'

import { getNumAlgoFromPeerDid, isValidPeerDid, PeerDidNumAlgo } from './didPeer'
import { didToNumAlgo0DidDocument } from './peerDidNumAlgo0'
import { didToNumAlgo2DidDocument } from './peerDidNumAlgo2'

export class PeerDidResolver implements DidResolver {
  public readonly supportedMethods = ['peer']

  private didRepository: DidRepository

  public constructor(didRepository: DidRepository) {
    this.didRepository = didRepository
  }

  public async resolve(did: string): Promise<DidResolutionResult> {
    const didDocumentMetadata = {}

    try {
      let didDocument: DidDocument

      if (!isValidPeerDid(did)) {
        throw new AriesFrameworkError(`did ${did} is not a valid peer did`)
      }

      const numAlgo = getNumAlgoFromPeerDid(did)

      // For method 0, generate from did
      if (numAlgo === PeerDidNumAlgo.InceptionKeyWithoutDoc) {
        didDocument = didToNumAlgo0DidDocument(did)
      }
      // For Method 1, retrieve from storage
      else if (numAlgo === PeerDidNumAlgo.GenesisDoc) {
        const didDocumentRecord = await this.didRepository.getById(did)

        if (!didDocumentRecord.didDocument) {
          throw new AriesFrameworkError(`Found did record for method 1 peer did (${did}), but no did document.`)
        }

        didDocument = didDocumentRecord.didDocument
      }
      // For Method 2, generate from did
      else {
        didDocument = didToNumAlgo2DidDocument(did)
      }

      return {
        didDocument,
        didDocumentMetadata,
        didResolutionMetadata: { contentType: 'application/did+ld+json' },
      }
    } catch (error) {
      return {
        didDocument: null,
        didDocumentMetadata,
        didResolutionMetadata: {
          error: 'notFound',
          message: `resolver_error: Unable to resolve did '${did}': ${error}`,
        },
      }
    }
  }
}
