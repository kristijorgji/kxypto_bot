import { runCommonPubSubTests } from './pubsub.shared-tests';
import MemoryPubSub from '../../../src/pubsub/MemoryPubSub';

runCommonPubSubTests(() => new MemoryPubSub(), 'MemoryPubSub');
