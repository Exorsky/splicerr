#include "PluginProcessor.h"
#include "PluginEditor.h"

#include <cmath>
#include <cstring>
#include <limits>
#include <vector>

namespace
{
constexpr int audioPacketHeaderBytes = 16;

double optionalOrZero(juce::Optional<double> value)
{
    return value.hasValue() ? *value : 0.0;
}

juce::String jsonBool(bool value)
{
    return value ? "true" : "false";
}

uint16_t readU16LE(const char* data)
{
    return static_cast<uint16_t>(static_cast<unsigned char>(data[0]))
        | static_cast<uint16_t>(static_cast<unsigned char>(data[1]) << 8);
}

float readF32LE(const char* data)
{
    uint32_t value = static_cast<uint32_t>(static_cast<unsigned char>(data[0]))
        | (static_cast<uint32_t>(static_cast<unsigned char>(data[1])) << 8)
        | (static_cast<uint32_t>(static_cast<unsigned char>(data[2])) << 16)
        | (static_cast<uint32_t>(static_cast<unsigned char>(data[3])) << 24);

    float sample = 0.0f;
    std::memcpy(&sample, &value, sizeof(sample));
    return sample;
}

double positiveModulo(double value, double divisor)
{
    if (divisor <= 0.0)
        return 0.0;

    const auto result = std::fmod(value, divisor);
    return result < 0.0 ? result + divisor : result;
}

template <typename FloatType>
FloatType readBufferAt(const juce::AudioBuffer<float>& buffer,
                       int channel,
                       double position)
{
    const auto numFrames = buffer.getNumSamples();
    const auto numChannels = buffer.getNumChannels();

    if (numFrames <= 0 || numChannels <= 0)
        return static_cast<FloatType>(0);

    const auto sourceChannel = juce::jlimit(0, numChannels - 1, channel);
    const auto boundedPosition = positiveModulo(position, static_cast<double>(numFrames));
    const auto index = juce::jlimit(0, numFrames - 1, static_cast<int>(std::floor(boundedPosition)));
    const auto nextIndex = juce::jmin(index + 1, numFrames - 1);
    const auto fraction = static_cast<float>(boundedPosition - std::floor(boundedPosition));
    const auto* data = buffer.getReadPointer(sourceChannel);

    return static_cast<FloatType>(data[index] + (data[nextIndex] - data[index]) * fraction);
}
} // namespace

SplicerrBridgeAudioProcessor::SplicerrBridgeAudioProcessor()
    : AudioProcessor(BusesProperties()
                         .withInput("Input", juce::AudioChannelSet::stereo(), false)
                         .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      socket(false),
      audioSocket(false)
{
    formatManager.registerBasicFormats();
    startAudioReceiver();
    startTimerHz(timerHz);
}

SplicerrBridgeAudioProcessor::~SplicerrBridgeAudioProcessor()
{
    stopTimer();
    stopAudioReceiver();
}

void SplicerrBridgeAudioProcessor::prepareToPlay(double sampleRate, int)
{
    currentSampleRate.store(sampleRate);
    sendSnapshot(true);
}

void SplicerrBridgeAudioProcessor::releaseResources() {}

bool SplicerrBridgeAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto& mainIn = layouts.getMainInputChannelSet();
    const auto& mainOut = layouts.getMainOutputChannelSet();
    const auto outputSupported =
        mainOut == juce::AudioChannelSet::mono()
        || mainOut == juce::AudioChannelSet::stereo();
    const auto inputSupported =
        mainIn.isDisabled()
        || mainIn == juce::AudioChannelSet::mono()
        || mainIn == juce::AudioChannelSet::stereo();

    return outputSupported && inputSupported;
}

template <typename FloatType>
void SplicerrBridgeAudioProcessor::processTransport(juce::AudioBuffer<FloatType>& buffer)
{
    juce::ignoreUnused(buffer);

    if (auto* playHead = getPlayHead())
    {
        if (auto position = playHead->getPosition())
        {
            hostPlaying.store(position->getIsPlaying());
            hostBpm.store(optionalOrZero(position->getBpm()));
            hostPpqPosition.store(optionalOrZero(position->getPpqPosition()));
            hostTimeInSeconds.store(optionalOrZero(position->getTimeInSeconds()));
            hostLooping.store(position->getIsLooping());

            if (auto signature = position->getTimeSignature())
            {
                hostTimeSignatureNumerator.store(signature->numerator);
                hostTimeSignatureDenominator.store(signature->denominator);
            }

            if (auto loop = position->getLoopPoints())
            {
                hostLoopStartPpq.store(loop->ppqStart);
                hostLoopEndPpq.store(loop->ppqEnd);
            }
        }
    }
}

template <typename FloatType>
void passAudioThrough(juce::AudioProcessor& processor, juce::AudioBuffer<FloatType>& buffer)
{
    const auto totalInputChannels = processor.getTotalNumInputChannels();
    const auto totalOutputChannels = processor.getTotalNumOutputChannels();

    if (totalInputChannels == 0)
    {
        buffer.clear();
        return;
    }

    for (auto channel = totalInputChannels; channel < totalOutputChannels; ++channel)
        buffer.clear(channel, 0, buffer.getNumSamples());
}

void SplicerrBridgeAudioProcessor::startAudioReceiver()
{
    if (audioReceiverRunning.load())
        return;

    if (! audioSocket.bindToPort(0, "127.0.0.1"))
        return;

    audioUdpPort.store(audioSocket.getBoundPort());
    audioReceiverRunning.store(true);
    audioReceiverThread = std::thread([this]
    {
        std::vector<char> packet(65536);

        while (audioReceiverRunning.load())
        {
            if (audioSocket.waitUntilReady(true, 100) <= 0)
                continue;

            const auto bytesRead = audioSocket.read(packet.data(), static_cast<int>(packet.size()), false);
            if (bytesRead < 4)
                continue;

            if (std::memcmp(packet.data(), "SPSM", 4) == 0)
            {
                handleSamplePacket(packet.data() + 4, bytesRead - 4);
                continue;
            }

            if (std::memcmp(packet.data(), "SPCT", 4) == 0)
            {
                handleControlPacket(packet.data() + 4, bytesRead - 4);
                continue;
            }

            if (bytesRead < audioPacketHeaderBytes)
                continue;

            if (std::memcmp(packet.data(), "SPAU", 4) != 0)
                continue;

            const auto channels = static_cast<unsigned char>(packet[12]);
            const auto frames = static_cast<int>(readU16LE(packet.data() + 14));
            if (channels == 0 || channels > 2 || frames <= 0)
                continue;

            const auto expectedBytes = audioPacketHeaderBytes + frames * channels * static_cast<int>(sizeof(float));
            if (bytesRead < expectedBytes)
                continue;

            std::vector<float> stereo(static_cast<size_t>(frames * streamedAudioChannels), 0.0f);
            const auto* sampleData = packet.data() + audioPacketHeaderBytes;
            for (auto frame = 0; frame < frames; ++frame)
            {
                const auto left = readF32LE(sampleData + (frame * channels) * 4);
                const auto right = channels > 1
                    ? readF32LE(sampleData + (frame * channels + 1) * 4)
                    : left;
                stereo[static_cast<size_t>(frame * 2)] = left;
                stereo[static_cast<size_t>(frame * 2 + 1)] = right;
            }

            pushAudioSamples(stereo.data(), frames);
            lastAudioPacketMs.store(static_cast<int64_t>(juce::Time::getMillisecondCounter()));
        }
    });
}

void SplicerrBridgeAudioProcessor::stopAudioReceiver()
{
    audioReceiverRunning.store(false);
    audioSocket.shutdown();

    if (audioReceiverThread.joinable())
        audioReceiverThread.join();
}

void SplicerrBridgeAudioProcessor::pushAudioSamples(const float* samples, int frames)
{
    std::lock_guard<std::mutex> lock(audioMutex);

    const auto maxSamples = maxQueuedAudioFrames * streamedAudioChannels;
    while (static_cast<int>(audioQueue.size()) + frames * streamedAudioChannels > maxSamples)
    {
        for (auto i = 0; i < streamedAudioChannels && ! audioQueue.empty(); ++i)
            audioQueue.pop_front();
    }

    for (auto i = 0; i < frames * streamedAudioChannels; ++i)
        audioQueue.push_back(samples[i]);
}

void SplicerrBridgeAudioProcessor::handleSamplePacket(const char* data, int bytes)
{
    const auto payload = juce::String::fromUTF8(data, bytes);
    const auto parsed = juce::JSON::parse(payload);

    if (! parsed.isObject())
        return;

    const auto* object = parsed.getDynamicObject();
    if (object == nullptr)
        return;

    if (object->getProperty("source").toString() != "splicerr-app")
        return;

    const auto path = object->getProperty("path").toString();
    const auto uuid = object->getProperty("uuid").toString();
    const auto oneShot = static_cast<bool>(object->getProperty("oneShot"));
    const auto durationMs = static_cast<double>(object->getProperty("durationMs"));

    loadSampleFromPath(path, uuid, oneShot, durationMs);
}

void SplicerrBridgeAudioProcessor::handleControlPacket(const char* data, int bytes)
{
    const auto payload = juce::String::fromUTF8(data, bytes);
    const auto parsed = juce::JSON::parse(payload);

    if (! parsed.isObject())
        return;

    const auto* object = parsed.getDynamicObject();
    if (object == nullptr)
        return;

    if (object->getProperty("source").toString() != "splicerr-app")
        return;

    if (object->hasProperty("playbackEnabled"))
        appPlaybackEnabled.store(static_cast<bool>(object->getProperty("playbackEnabled")));
}

void SplicerrBridgeAudioProcessor::loadSampleFromPath(const juce::String& path,
                                                      const juce::String& uuid,
                                                      bool oneShot,
                                                      double durationMs)
{
    const juce::File file(path);
    std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));

    if (reader == nullptr || reader->lengthInSamples <= 0)
    {
        std::lock_guard<std::mutex> lock(sampleMutex);
        loadedSample.reset();
        sampleLoaded.store(false);
        loadedSampleDurationSeconds.store(0.0);
        samplePositionSeconds.store(0.0);
        sampleActive.store(false);
        sampleRevision.fetch_add(1);
        return;
    }

    const auto channels = juce::jlimit<int>(1, 2, static_cast<int>(reader->numChannels));
    const auto frames = static_cast<int>(juce::jmin<juce::int64>(
        reader->lengthInSamples,
        static_cast<juce::int64>(std::numeric_limits<int>::max())));
    auto sample = std::make_shared<LoadedSample>();
    sample->buffer.setSize(channels, frames);
    sample->sampleRate = reader->sampleRate;
    sample->oneShot = oneShot;
    sample->uuid = uuid;
    sample->durationMs = durationMs;

    reader->read(&sample->buffer, 0, frames, 0, true, true);

    {
        std::lock_guard<std::mutex> lock(sampleMutex);
        loadedSample = sample;
    }

    sampleLoaded.store(true);
    loadedSampleDurationSeconds.store(static_cast<double>(frames) / sample->sampleRate);
    samplePositionSeconds.store(0.0);
    sampleActive.store(false);
    lastSampleLoadMs.store(static_cast<int64_t>(juce::Time::getMillisecondCounter()));
    sampleRevision.fetch_add(1);
    sendSnapshot(true);
}

template <typename FloatType>
void SplicerrBridgeAudioProcessor::mixStreamedAudio(juce::AudioBuffer<FloatType>& buffer)
{
    const auto outputChannels = getTotalNumOutputChannels();
    if (outputChannels <= 0)
        return;

    const auto frames = buffer.getNumSamples();
    std::vector<float> local(static_cast<size_t>(frames * streamedAudioChannels), 0.0f);
    auto framesRead = 0;

    {
        std::lock_guard<std::mutex> lock(audioMutex);
        framesRead = std::min(frames, static_cast<int>(audioQueue.size()) / streamedAudioChannels);

        for (auto i = 0; i < framesRead * streamedAudioChannels; ++i)
        {
            local[static_cast<size_t>(i)] = audioQueue.front();
            audioQueue.pop_front();
        }
    }

    for (auto frame = 0; frame < framesRead; ++frame)
    {
        const auto left = static_cast<FloatType>(local[static_cast<size_t>(frame * 2)]);
        const auto right = static_cast<FloatType>(local[static_cast<size_t>(frame * 2 + 1)]);

        buffer.addSample(0, frame, left);
        if (outputChannels > 1)
            buffer.addSample(1, frame, right);
    }
}

template <typename FloatType>
void SplicerrBridgeAudioProcessor::renderLoadedSample(juce::AudioBuffer<FloatType>& buffer)
{
    std::shared_ptr<const LoadedSample> sample;
    {
        std::lock_guard<std::mutex> lock(sampleMutex);
        sample = loadedSample;
    }

    if (sample == nullptr || sample->buffer.getNumSamples() <= 0)
        return;

    const auto outputChannels = getTotalNumOutputChannels();
    const auto outputFrames = buffer.getNumSamples();
    const auto hostRate = currentSampleRate.load();
    const auto bpm = hostBpm.load();
    const auto ppqStart = hostPpqPosition.load();
    const auto numerator = hostTimeSignatureNumerator.load();
    const auto denominator = hostTimeSignatureDenominator.load();

    if (outputChannels <= 0 || outputFrames <= 0 || hostRate <= 0.0 || bpm <= 0.0)
        return;

    const auto revision = sampleRevision.load();
    if (renderedSampleRevision != revision)
    {
        renderedSampleRevision = revision;
        lastOneShotTriggerBar = std::numeric_limits<int64_t>::min();
        oneShotActive = false;
        oneShotReadPosition = 0.0;
        loopReadPosition = 0.0;
        samplePositionSeconds.store(0.0);
        sampleActive.store(false);
        lastRenderedPpq = std::numeric_limits<double>::quiet_NaN();
        lastRenderedHostTime = std::numeric_limits<double>::quiet_NaN();
        lastOneShotTriggerPpq = -std::numeric_limits<double>::infinity();
    }

    if (! hostPlaying.load() || ! appPlaybackEnabled.load())
    {
        oneShotActive = false;
        oneShotReadPosition = 0.0;
        lastOneShotTriggerBar = std::numeric_limits<int64_t>::min();
        loopReadPosition = 0.0;
        samplePositionSeconds.store(0.0);
        sampleActive.store(false);
        lastRenderedPpq = std::numeric_limits<double>::quiet_NaN();
        lastRenderedHostTime = std::numeric_limits<double>::quiet_NaN();
        lastOneShotTriggerPpq = -std::numeric_limits<double>::infinity();
        return;
    }

    const auto beatsPerBar = juce::jmax(1.0, static_cast<double>(numerator) * (4.0 / static_cast<double>(denominator)));
    const auto beatStep = (bpm / 60.0) / hostRate;
    const auto sourceStep = sample->sampleRate / hostRate;
    const auto hostTimeStart = hostTimeInSeconds.load();
    const auto loopActive = hostLooping.load();
    const auto loopStart = hostLoopStartPpq.load();
    const auto loopEnd = hostLoopEndPpq.load();
    const auto ppqMovedBack =
        std::isfinite(lastRenderedPpq) && ppqStart < lastRenderedPpq - beatStep * 2.0;
    const auto crossedHostLoopBoundary =
        loopActive
        && loopEnd > loopStart
        && std::isfinite(lastRenderedPpq)
        && lastRenderedPpq >= loopEnd - beatStep * 2.0
        && ppqStart <= loopStart + beatStep * 4.0;
    const auto hostTimeMovedBack =
        std::isfinite(lastRenderedHostTime)
        && hostTimeStart > 0.0
        && hostTimeStart < lastRenderedHostTime - (2.0 / hostRate);
    const auto hostTimeUnavailable = hostTimeStart <= 0.0 || ! std::isfinite(hostTimeStart);
    const auto transportWrapped =
        crossedHostLoopBoundary
        || (ppqMovedBack && (hostTimeMovedBack || hostTimeUnavailable));

    if (transportWrapped)
    {
        lastOneShotTriggerBar = std::numeric_limits<int64_t>::min();
        lastOneShotTriggerPpq = -std::numeric_limits<double>::infinity();
        oneShotActive = false;
        oneShotReadPosition = 0.0;
        loopReadPosition = 0.0;
        samplePositionSeconds.store(0.0);
        sampleActive.store(false);
        lastRenderedHostTime = std::numeric_limits<double>::quiet_NaN();
    }

    if (sample->oneShot)
    {
        const auto triggerWindowBeats = juce::jmax(beatStep * 2.0, 0.0001);
        const auto minRetriggerDistanceBeats = beatsPerBar * 0.5;

        for (auto frame = 0; frame < outputFrames; ++frame)
        {
            const auto ppq = ppqStart + static_cast<double>(frame) * beatStep;
            const auto barIndex = static_cast<int64_t>(std::floor(ppq / beatsPerBar));
            const auto positionInBar = positiveModulo(ppq, beatsPerBar);
            const auto farEnoughFromPreviousTrigger =
                ppq < lastOneShotTriggerPpq
                || ppq - lastOneShotTriggerPpq >= minRetriggerDistanceBeats;

            if (! oneShotActive
                && barIndex != lastOneShotTriggerBar
                && positionInBar <= triggerWindowBeats
                && farEnoughFromPreviousTrigger)
            {
                oneShotActive = true;
                oneShotReadPosition = 0.0;
                samplePositionSeconds.store(0.0);
                sampleActive.store(true);
                lastOneShotTriggerBar = barIndex;
                lastOneShotTriggerPpq = ppq;
            }

            if (! oneShotActive)
                continue;

            if (oneShotReadPosition >= sample->buffer.getNumSamples())
            {
                oneShotActive = false;
                oneShotReadPosition = 0.0;
                samplePositionSeconds.store(0.0);
                sampleActive.store(false);
                continue;
            }

            const auto left = readBufferAt<FloatType>(sample->buffer, 0, oneShotReadPosition);
            const auto right = readBufferAt<FloatType>(sample->buffer,
                                                       sample->buffer.getNumChannels() > 1 ? 1 : 0,
                                                       oneShotReadPosition);

            buffer.addSample(0, frame, left);
            if (outputChannels > 1)
                buffer.addSample(1, frame, right);

            oneShotReadPosition += sourceStep;
        }

        if (oneShotActive)
            samplePositionSeconds.store(oneShotReadPosition / sample->sampleRate);
        sampleActive.store(oneShotActive);

        lastRenderedPpq = ppqStart + static_cast<double>(outputFrames) * beatStep;
        lastRenderedHostTime = hostTimeStart + static_cast<double>(outputFrames) / hostRate;
        return;
    }

    for (auto frame = 0; frame < outputFrames; ++frame)
    {
        if (! std::isfinite(lastRenderedPpq) && frame == 0)
        {
            const auto projectSeconds = ppqStart * (60.0 / bpm);
            const auto sampleSeconds = sample->buffer.getNumSamples() / sample->sampleRate;
            loopReadPosition = positiveModulo(projectSeconds, sampleSeconds) * sample->sampleRate;
            samplePositionSeconds.store(loopReadPosition / sample->sampleRate);
        }

        const auto left = readBufferAt<FloatType>(sample->buffer, 0, loopReadPosition);
        const auto right = readBufferAt<FloatType>(sample->buffer,
                                                   sample->buffer.getNumChannels() > 1 ? 1 : 0,
                                                   loopReadPosition);

        buffer.addSample(0, frame, left);
        if (outputChannels > 1)
            buffer.addSample(1, frame, right);

        loopReadPosition = positiveModulo(
            loopReadPosition + sourceStep,
            static_cast<double>(sample->buffer.getNumSamples()));
    }

    samplePositionSeconds.store(loopReadPosition / sample->sampleRate);
    sampleActive.store(true);
    lastRenderedPpq = ppqStart + static_cast<double>(outputFrames) * beatStep;
    lastRenderedHostTime = hostTimeStart + static_cast<double>(outputFrames) / hostRate;
}

void SplicerrBridgeAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    processTransport(buffer);
    passAudioThrough(*this, buffer);
    renderLoadedSample(buffer);
}

void SplicerrBridgeAudioProcessor::processBlock(juce::AudioBuffer<double>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    processTransport(buffer);
    passAudioThrough(*this, buffer);
    renderLoadedSample(buffer);
}

juce::AudioProcessorEditor* SplicerrBridgeAudioProcessor::createEditor()
{
    return new SplicerrBridgeAudioProcessorEditor(*this);
}

bool SplicerrBridgeAudioProcessor::hasEditor() const
{
    return true;
}

const juce::String SplicerrBridgeAudioProcessor::getName() const
{
    return JucePlugin_Name;
}

bool SplicerrBridgeAudioProcessor::acceptsMidi() const
{
    return true;
}

bool SplicerrBridgeAudioProcessor::producesMidi() const
{
    return false;
}

bool SplicerrBridgeAudioProcessor::isMidiEffect() const
{
    return false;
}

double SplicerrBridgeAudioProcessor::getTailLengthSeconds() const
{
    return 0.0;
}

int SplicerrBridgeAudioProcessor::getNumPrograms()
{
    return 1;
}

int SplicerrBridgeAudioProcessor::getCurrentProgram()
{
    return 0;
}

void SplicerrBridgeAudioProcessor::setCurrentProgram(int) {}

const juce::String SplicerrBridgeAudioProcessor::getProgramName(int)
{
    return {};
}

void SplicerrBridgeAudioProcessor::changeProgramName(int, const juce::String&) {}

void SplicerrBridgeAudioProcessor::getStateInformation(juce::MemoryBlock&) {}

void SplicerrBridgeAudioProcessor::setStateInformation(const void*, int) {}

bool SplicerrBridgeAudioProcessor::hasSentToAppRecently() const noexcept
{
    const auto now = juce::Time::getMillisecondCounter();
    return now - static_cast<uint32_t>(lastPacketMs.load()) < 1500;
}

bool SplicerrBridgeAudioProcessor::hasReceivedAudioRecently() const noexcept
{
    const auto now = juce::Time::getMillisecondCounter();
    return now - static_cast<uint32_t>(lastAudioPacketMs.load()) < 1500;
}

bool SplicerrBridgeAudioProcessor::hasLoadedSampleRecently() const noexcept
{
    const auto now = juce::Time::getMillisecondCounter();
    return sampleLoaded.load()
        && now - static_cast<uint32_t>(lastSampleLoadMs.load()) < 3000;
}

void SplicerrBridgeAudioProcessor::timerCallback()
{
    sendSnapshot(false);
}

void SplicerrBridgeAudioProcessor::sendSnapshot(bool force)
{
    const auto playing = hostPlaying.load();
    const auto bpm = hostBpm.load();
    const auto ppq = hostPpqPosition.load();
    const auto numerator = hostTimeSignatureNumerator.load();
    const auto denominator = hostTimeSignatureDenominator.load();
    const auto samplePosition = samplePositionSeconds.load();
    const auto active = sampleActive.load();
    const auto now = juce::Time::getMillisecondCounter();
    const auto wallClockMs = juce::Time::getCurrentTime().toMilliseconds();

    const auto transportChanged = playing != lastSentPlaying
        || std::abs(bpm - lastSentBpm) > 0.001
        || std::abs(ppq - lastSentPpqPosition) > 0.01
        || std::abs(samplePosition - lastSentSamplePositionSeconds) > 0.01
        || active != lastSentSampleActive
        || numerator != lastSentTimeSignatureNumerator
        || denominator != lastSentTimeSignatureDenominator;
    const auto needsKeepAlive = now - static_cast<uint32_t>(lastPacketMs.load()) >= keepAliveMs;

    if (! force && ! transportChanged && ! needsKeepAlive)
        return;

    const juce::String payload = "{"
        "\"source\":\"splicerr-bridge\","
        "\"version\":1,"
        "\"playing\":" + jsonBool(playing) + ","
        "\"bpm\":" + juce::String(bpm, 6) + ","
        "\"ppqPosition\":" + juce::String(ppq, 6) + ","
        "\"timeInSeconds\":" + juce::String(hostTimeInSeconds.load(), 6) + ","
        "\"packetSentAtMs\":" + juce::String(wallClockMs) + ","
        "\"audioPort\":" + juce::String(audioUdpPort.load()) + ","
        "\"timeSignatureNumerator\":" + juce::String(numerator) + ","
        "\"timeSignatureDenominator\":" + juce::String(denominator) + ","
        "\"looping\":" + jsonBool(hostLooping.load()) + ","
        "\"loopStartPpq\":" + juce::String(hostLoopStartPpq.load(), 6) + ","
        "\"loopEndPpq\":" + juce::String(hostLoopEndPpq.load(), 6) + ","
        "\"loadedSampleDurationSeconds\":" + juce::String(loadedSampleDurationSeconds.load(), 6) + ","
        "\"samplePositionSeconds\":" + juce::String(samplePosition, 6) + ","
        "\"sampleActive\":" + jsonBool(active) + ","
        "\"sampleRate\":" + juce::String(currentSampleRate.load(), 1) +
    "}";

    socket.write("127.0.0.1", udpPort, payload.toRawUTF8(), static_cast<int>(payload.getNumBytesAsUTF8()));

    lastSentPlaying = playing;
    lastSentBpm = bpm;
    lastSentPpqPosition = ppq;
    lastSentSamplePositionSeconds = samplePosition;
    lastSentSampleActive = active;
    lastSentTimeSignatureNumerator = numerator;
    lastSentTimeSignatureDenominator = denominator;
    lastPacketMs.store(static_cast<int64_t>(now));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SplicerrBridgeAudioProcessor();
}
