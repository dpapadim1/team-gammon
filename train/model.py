"""The value network. Layout and JSON export match bots/nn.js, which does the playing."""
import base64

import numpy as np
import torch
from torch import nn

FORMAT = "team-gammon-value-net"
FEATURES_VERSION = 2
SPARSE = 1001
DENSE = 16


def _b64(tensor):
    array = np.ascontiguousarray(tensor.detach().cpu().numpy().astype("<f4"))
    return base64.b64encode(array.tobytes()).decode("ascii")


def _from_b64(text, shape):
    array = np.frombuffer(base64.b64decode(text), dtype="<f4")
    if array.size != int(np.prod(shape)):
        raise ValueError(f"expected {int(np.prod(shape))} numbers, found {array.size}")
    return torch.from_numpy(array.reshape(shape).copy())


class ValueNet(nn.Module):
    """Sparse binary inputs (an embedding bag) plus dense inputs, ReLU layers, one logit."""

    def __init__(self, hidden=(192, 96), sparse=SPARSE, dense=DENSE):
        super().__init__()
        self.sparse = sparse
        self.dense = dense
        self.hidden = tuple(hidden)
        self.emb = nn.EmbeddingBag(sparse + 1, self.hidden[0], mode="sum", padding_idx=sparse)
        self.dense_w = nn.Parameter(torch.zeros(dense, self.hidden[0]))
        self.b1 = nn.Parameter(torch.zeros(self.hidden[0]))
        self.layers = nn.ModuleList(nn.Linear(a, b) for a, b in zip(self.hidden[:-1], self.hidden[1:]))
        self.out = nn.Linear(self.hidden[-1], 1)
        nn.init.normal_(self.emb.weight, 0.0, 0.1)
        nn.init.normal_(self.dense_w, 0.0, 0.1)
        with torch.no_grad():
            self.emb.weight[sparse].zero_()

    def forward(self, idx, dense):
        """idx (B, A) int64 with `sparse` as padding, dense (B, D) float32. Returns logits (B,)."""
        h = torch.relu(self.emb(idx) + dense @ self.dense_w + self.b1)
        for layer in self.layers:
            h = torch.relu(layer(h))
        return self.out(h).squeeze(-1)

    def to_json(self, meta=None):
        layers = [{
            "in": self.sparse,
            "out": self.hidden[0],
            "weights": _b64(self.emb.weight[: self.sparse]),
            "denseWeights": _b64(self.dense_w),
            "bias": _b64(self.b1),
        }]
        for layer in self.layers:
            layers.append({"in": layer.in_features, "out": layer.out_features, "weights": _b64(layer.weight.T), "bias": _b64(layer.bias)})
        layers.append({"in": self.out.in_features, "out": 1, "weights": _b64(self.out.weight.T), "bias": _b64(self.out.bias)})
        return {"format": FORMAT, "featuresVersion": FEATURES_VERSION, "sparse": self.sparse, "dense": self.dense, "layers": layers, "meta": meta or {}}

    @classmethod
    def from_json(cls, data):
        if data.get("format") != FORMAT:
            raise ValueError("not a team-gammon value network")
        if data["featuresVersion"] != FEATURES_VERSION or data["sparse"] != SPARSE or data["dense"] != DENSE:
            raise ValueError("the network was trained for a different feature set")
        layers = data["layers"]
        hidden = [layer["out"] for layer in layers[:-1]]
        net = cls(hidden)
        with torch.no_grad():
            first = layers[0]
            net.emb.weight[:SPARSE] = _from_b64(first["weights"], (SPARSE, hidden[0]))
            net.dense_w.copy_(_from_b64(first["denseWeights"], (DENSE, hidden[0])))
            net.b1.copy_(_from_b64(first["bias"], (hidden[0],)))
            for module, spec in zip(net.layers, layers[1:-1]):
                module.weight.copy_(_from_b64(spec["weights"], (spec["in"], spec["out"])).T)
                module.bias.copy_(_from_b64(spec["bias"], (spec["out"],)))
            last = layers[-1]
            net.out.weight.copy_(_from_b64(last["weights"], (last["in"], 1)).T)
            net.out.bias.copy_(_from_b64(last["bias"], (1,)))
        return net
