// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract CloudStorage {
    struct File {
        string fileId;        // SHA256 hash of file content
        string ipfsHash;      // IPFS CID (empty if not pinned)
        string fileName;
        uint256 fileSize;
        uint256 uploadTime;
        address owner;
        bool isEncrypted;
        string folderName;
    }

    struct SharedFileRef {
        address owner;
        string fileId;
    }

    mapping(address => File[]) private userFiles;
    mapping(address => string[]) private userFolders;
    mapping(address => mapping(string => address[])) private fileRecipients;
    mapping(address => SharedFileRef[]) private sharedFileRefs;

    event FileUploaded(
        address indexed owner,
        string fileId,
        string ipfsHash,
        string fileName,
        uint256 fileSize,
        uint256 uploadTime,
        bool isEncrypted,
        string folderName
    );
    event FileDeleted(address indexed owner, string fileId);
    event FileRenamed(address indexed owner, string fileId, string oldName, string newName);
    event FileShared(address indexed owner, address indexed recipient, string fileId, string fileName);
    event FileMoved(address indexed owner, string fileId, string oldFolder, string newFolder);
    event FolderCreated(address indexed owner, string folderName);

    function uploadFile(
        string memory _fileId,
        string memory _ipfsHash,
        string memory _fileName,
        uint256 _fileSize,
        bool _isEncrypted,
        string memory _folderName
    ) public {
        require(bytes(_fileId).length > 0, "File ID cannot be empty");
        require(bytes(_fileName).length > 0, "File name cannot be empty");
        require(_fileSize > 0, "File size must be greater than 0");
        ensureFolder(msg.sender, _folderName);

        File memory newFile = File({
            fileId: _fileId,
            ipfsHash: _ipfsHash,
            fileName: _fileName,
            fileSize: _fileSize,
            uploadTime: block.timestamp,
            owner: msg.sender,
            isEncrypted: _isEncrypted,
            folderName: _folderName
        });

        userFiles[msg.sender].push(newFile);

        emit FileUploaded(msg.sender, _fileId, _ipfsHash, _fileName, _fileSize, block.timestamp, _isEncrypted, _folderName);
    }

    function getMyFiles() public view returns (File[] memory) {
        return userFiles[msg.sender];
    }

    function getFileCount() public view returns (uint256) {
        return userFiles[msg.sender].length;
    }

    function createFolder(string memory _folderName) public {
        require(bytes(_folderName).length > 0, "Folder name cannot be empty");
        require(!folderExists(msg.sender, _folderName), "Folder already exists");
        userFolders[msg.sender].push(_folderName);
        emit FolderCreated(msg.sender, _folderName);
    }

    function getMyFolders() public view returns (string[] memory) {
        return userFolders[msg.sender];
    }

    function shareFile(string memory _fileId, address _recipient) public {
        require(_recipient != address(0), "Invalid recipient");
        require(_recipient != msg.sender, "Cannot share with yourself");

        uint256 index = findFileIndex(_fileId);
        File memory file = userFiles[msg.sender][index];
        require(!file.isEncrypted, "Encrypted files cannot be shared");

        address[] storage recipients = fileRecipients[msg.sender][_fileId];
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != _recipient, "File already shared with recipient");
        }

        recipients.push(_recipient);
        sharedFileRefs[_recipient].push(SharedFileRef({
            owner: msg.sender,
            fileId: _fileId
        }));

        emit FileShared(msg.sender, _recipient, _fileId, file.fileName);
    }

    function getFilesSharedWithMe() public view returns (File[] memory) {
        SharedFileRef[] storage refs = sharedFileRefs[msg.sender];
        File[] memory files = new File[](refs.length);

        for (uint256 i = 0; i < refs.length; i++) {
            files[i] = getFileById(refs[i].owner, refs[i].fileId);
        }

        return files;
    }

    function findFileIndex(string memory _fileId) private view returns (uint256) {
        return findFileIndexForOwner(msg.sender, _fileId);
    }

    function findFileIndexForOwner(address _owner, string memory _fileId) private view returns (uint256) {
        File[] storage files = userFiles[_owner];

        for (uint256 i = 0; i < files.length; i++) {
            if (keccak256(bytes(files[i].fileId)) == keccak256(bytes(_fileId))) {
                return i;
            }
        }

        revert("File ID not found");
    }

    function getFileById(address _owner, string memory _fileId) private view returns (File memory) {
        uint256 index = findFileIndexForOwner(_owner, _fileId);
        return userFiles[_owner][index];
    }

    function deleteFile(string memory _fileId) public {
        uint256 index = findFileIndex(_fileId);
        uint256 lastIndex = userFiles[msg.sender].length - 1;

        if (index != lastIndex) {
            userFiles[msg.sender][index] = userFiles[msg.sender][lastIndex];
        }

        userFiles[msg.sender].pop();

        emit FileDeleted(msg.sender, _fileId);
    }

    function getFile(uint256 _index) public view returns (File memory) {
        require(_index < userFiles[msg.sender].length, "File index out of bounds");
        return userFiles[msg.sender][_index];
    }

    function renameFile(string memory _fileId, string memory _newName) public {
        require(bytes(_newName).length > 0, "File name cannot be empty");

        uint256 index = findFileIndex(_fileId);
        string memory oldName = userFiles[msg.sender][index].fileName;
        userFiles[msg.sender][index].fileName = _newName;

        emit FileRenamed(msg.sender, _fileId, oldName, _newName);
    }

    function moveFileToFolder(string memory _fileId, string memory _folderName) public {
        uint256 index = findFileIndex(_fileId);
        string memory oldFolder = userFiles[msg.sender][index].folderName;
        ensureFolder(msg.sender, _folderName);
        userFiles[msg.sender][index].folderName = _folderName;

        emit FileMoved(msg.sender, _fileId, oldFolder, _folderName);
    }

    function ensureFolder(address _owner, string memory _folderName) private {
        if (bytes(_folderName).length == 0 || folderExists(_owner, _folderName)) return;
        userFolders[_owner].push(_folderName);
        emit FolderCreated(_owner, _folderName);
    }

    function folderExists(address _owner, string memory _folderName) private view returns (bool) {
        string[] storage folders = userFolders[_owner];
        for (uint256 i = 0; i < folders.length; i++) {
            if (keccak256(bytes(folders[i])) == keccak256(bytes(_folderName))) {
                return true;
            }
        }
        return false;
    }
}
